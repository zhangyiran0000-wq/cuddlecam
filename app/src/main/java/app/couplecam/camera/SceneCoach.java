package app.couplecam.camera;

import android.app.ActivityManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.SystemClock;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

final class SceneCoach {
    interface Listener { void result(int ticket, int scene, double confidence, long millis); }
    private final Context app;
    private final Listener listener;
    private final ScheduledThreadPoolExecutor worker = new ScheduledThreadPoolExecutor(1);
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile boolean closed;
    private volatile int active;
    // Only the worker thread touches the native sessions and their idle timer.
    private SceneVlm model;
    private ScheduledFuture<?> release;

    SceneCoach(Context context, Listener listener) {
        app = context.getApplicationContext();
        this.listener = listener;
        worker.setRemoveOnCancelPolicy(true);
        worker.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
    }

    synchronized boolean request(int ticket, String jpeg) {
        if (closed || ticket <= 0 || jpeg == null || jpeg.length() > 750000 || !busy.compareAndSet(false,true)) return false;
        active = ticket;
        worker.execute(() -> analyze(ticket,jpeg));
        return true;
    }

    private void analyze(int ticket, String jpeg) {
        long start = SystemClock.elapsedRealtime();
        int scene = -1;
        double confidence = 0;
        try {
            if (release != null) release.cancel(false);
            if (active != ticket || closed) return;
            int[] pixels = readPixels(jpeg);
            if (model == null) {
                ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
                ((ActivityManager)app.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(info);
                if (info.lowMemory) throw new IOException("low memory");
                model = new SceneVlm(assetFile("vision"),assetFile("scene"));
            }
            if (active != ticket || closed) return;
            float[] scores = model.evaluate(pixels);
            int best = 0;
            for (int i=1;i<scores.length;i++) if (scores[i]>scores[best]) best=i;
            double sum=0;
            for (float value:scores) sum+=Math.exp(value-scores[best]);
            confidence=1/sum;
            scene=Double.isNaN(confidence)?-1:best;
        } catch (Exception | LinkageError | OutOfMemoryError e) {
            unload();
        } finally {
            busy.set(false);
            if (!closed && active==ticket) listener.result(ticket,scene,confidence,SystemClock.elapsedRealtime()-start);
            synchronized (this) {
                if (!closed) release=worker.schedule(this::unload,30,TimeUnit.SECONDS);
            }
        }
    }

    private String assetFile(String name) throws IOException {
        File target = new File(app.getCodeCacheDir(),"scene-coach-20-"+name+".onnx");
        if (!target.isFile()) {
            File tmp=File.createTempFile("vlm-", ".part",app.getCodeCacheDir());
            try {
                try(InputStream in=app.getAssets().open("vendor/coach/"+name+".onnx");
                    FileOutputStream out=new FileOutputStream(tmp)) {
                    byte[] buffer=new byte[131072];
                    for(int n;(n=in.read(buffer))!=-1;)out.write(buffer,0,n);
                }
                if (!tmp.renameTo(target) && !target.isFile()) throw new IOException("model cache");
            } finally { if(tmp.exists())tmp.delete(); }
        }
        return target.getAbsolutePath();
    }

    private static int[] readPixels(String jpeg) throws IOException {
        byte[] bytes=Base64.decode(jpeg,Base64.DEFAULT);
        BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;
        BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
        if (bounds.outWidth<1 || bounds.outHeight<1 || Math.max(bounds.outWidth,bounds.outHeight)>640) throw new IOException("image size");
        Bitmap src=BitmapFactory.decodeByteArray(bytes,0,bytes.length);
        if(src==null)throw new IOException("image");
        int side=SceneVlm.SIDE;
        Bitmap square=Bitmap.createBitmap(side,side,Bitmap.Config.ARGB_8888);
        try {
            Canvas c=new Canvas(square);c.drawColor(Color.rgb(127,127,127));
            float scale=(float)side/Math.max(src.getWidth(),src.getHeight());
            float w=src.getWidth()*scale,h=src.getHeight()*scale;
            c.drawBitmap(src,null,new RectF((side-w)/2,(side-h)/2,(side+w)/2,(side+h)/2),new Paint(Paint.FILTER_BITMAP_FLAG));
            int[] pixels=new int[side*side];square.getPixels(pixels,0,side,0,0,side,side);return pixels;
        } finally {square.recycle();src.recycle();}
    }
    private void unload(){
        if(model!=null){try{model.close();}catch(Exception ignored){}model=null;}
    }
    synchronized void pause(){active=0;if(!closed)worker.execute(this::unload);}
    synchronized void close(){if(closed)return;closed=true;active=0;worker.execute(this::unload);worker.shutdown();}
}
