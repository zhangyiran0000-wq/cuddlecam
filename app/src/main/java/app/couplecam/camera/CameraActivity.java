package app.couplecam.camera;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.media.AudioAttributes;
import android.media.MediaActionSound;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.view.Surface;
import android.view.Display;
import android.view.DisplayCutout;
import android.view.View;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.FrameLayout;
import java.io.*;
import java.util.*;

public final class CameraActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
    private SceneCoach sceneCoach;
    private MediaActionSound requiredSound;
    private PermissionRequest pendingCamera;
    private ValueCallback<Uri[]> picker;
    private TextToSpeech tts;
    private volatile boolean canSpeak;
    private final GuideGravity gravity=new GuideGravity();
    private boolean started;
    private volatile String cameraEdgeState="0,";
    private final DisplayManager.DisplayListener displayListener=new DisplayManager.DisplayListener(){
        @Override public void onDisplayAdded(int id){}
        @Override public void onDisplayRemoved(int id){}
        @Override public void onDisplayChanged(int id){updateCameraEdge();}
    };

    private void updateCameraEdge(){
        Display display=getWindowManager().getDefaultDisplay();
        DisplayCutout cutout=display.getCutout();
        String edge="";
        if(cutout!=null&&cutout.getBoundingRects().size()==1){
            if(!cutout.getBoundingRectTop().isEmpty())edge="top";
            else if(!cutout.getBoundingRectRight().isEmpty())edge="right";
            else if(!cutout.getBoundingRectBottom().isEmpty())edge="bottom";
            else if(!cutout.getBoundingRectLeft().isEmpty())edge="left";
        }
        String state=display.getRotation()+","+edge;
        if(state.equals(cameraEdgeState))return;
        cameraEdgeState=state;
        if(web!=null)web.evaluateJavascript("window.refreshShutterEdge?.()",null);
    }

    private final class GuideGravity implements SensorEventListener {
        private SensorManager manager;
        private Sensor sensor;
        private boolean active,filtered;
        private float gx,gy,gz;
        private long lastSample;
        private volatile long validAt;
        private volatile String tilt="";
        void enable(boolean on){
            if(!on){
                if(active)manager.unregisterListener(this);
                active=false;filtered=false;validAt=0;tilt="";return;
            }
            if(active||!started)return;
            manager=(SensorManager)getSystemService(SENSOR_SERVICE);
            if(manager==null)return;
            sensor=manager.getDefaultSensor(Sensor.TYPE_GRAVITY);
            if(sensor==null)sensor=manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            if(sensor!=null)active=manager.registerListener(this,sensor,80000);
        }
        @Override public void onSensorChanged(SensorEvent event){
            if(!active)return;
            float x=event.values[0],y=event.values[1],z=event.values[2];
            double magnitude=Math.sqrt(x*x+y*y+z*z);
            if(magnitude<7.8||magnitude>11.8){validAt=0;return;}
            if(sensor.getType()==Sensor.TYPE_ACCELEROMETER){
                float gain=filtered?(float)(1-Math.exp(-Math.min(.35,(event.timestamp-lastSample)*1e-9)/.30)):1;
                gx+=(x-gx)*gain;gy+=(y-gy)*gain;gz+=(z-gz)*gain;
                x=gx;y=gy;z=gz;filtered=true;lastSample=event.timestamp;
            }
            tilt=GuideAngles.fromDisplay(x,y,z,getWindowManager().getDefaultDisplay().getRotation());
            validAt=SystemClock.elapsedRealtime();
        }
        String read(){return validAt!=0&&SystemClock.elapsedRealtime()-validAt<850?tilt:"";}
        @Override public void onAccuracyChanged(Sensor s,int accuracy){}
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(22,29,27));
        if(android.os.Build.VERSION.SDK_INT>=35){
            root.setOnApplyWindowInsetsListener((v,insets)->{
                android.graphics.Insets b=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());
                v.setPadding(b.left,b.top,b.right,b.bottom); return insets;
            });
        }
        web=new WebView(this);web.setSoundEffectsEnabled(false);root.addView(web);setContentView(root);
        sceneCoach=new SceneCoach(this,(ticket,scene,confidence,ms)->runOnUiThread(()->{
            if(started&&!isDestroyed()&&web!=null)web.evaluateJavascript("window.sceneCoachResult?.("+ticket+","+scene+","+confidence+","+ms+")",null);
        }));
        WebSettings s=web.getSettings();
        s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Phone(),"Phone");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req){
                Uri uri=req.getUrl();String name=uri.getPath();
                if(!"https".equals(uri.getScheme())||!HOST.equals(uri.getHost())||name==null||name.contains("..")||!name.startsWith("/"))return missing();
                name=name.substring(1);
                String mime=name.endsWith(".mjs")||name.endsWith(".js")?"text/javascript":name.endsWith(".wasm")?"application/wasm":name.endsWith(".png")?"image/png":name.endsWith(".jpg")?"image/jpeg":name.endsWith(".wav")?"audio/wav":name.endsWith(".ogg")?"audio/ogg":name.endsWith(".woff2")?"font/woff2":name.endsWith(".ttf")?"font/ttf":name.endsWith(".css")?"text/css":name.endsWith(".html")?"text/html":name.endsWith(".json")?"application/json":"application/octet-stream";
                if(name.endsWith(".webp"))mime="image/webp";
                try{return new WebResourceResponse(mime,mime.startsWith("text/")?"UTF-8":null,getAssets().open(name));}
                catch(IOException err){return missing();}
            }
            private WebResourceResponse missing(){return new WebResourceResponse("text/plain","utf-8",404,"Missing",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onPermissionRequest(PermissionRequest request){
                runOnUiThread(()->{
                    if(!HOST.equals(request.getOrigin().getHost())||!Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)){request.deny();return;}
                    if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)grantCamera(request);
                    else {if(pendingCamera!=null)pendingCamera.deny();pendingCamera=request;requestPermissions(new String[]{Manifest.permission.CAMERA},10);}
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request){if(pendingCamera==request)pendingCamera=null;}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(picker!=null)picker.onReceiveValue(null); picker=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);
                String[] accept=params.getAcceptTypes();intent.setType(accept.length==1&&!accept[0].isEmpty()?accept[0]:"*/*");
                try{startActivityForResult(intent,11);}catch(android.content.ActivityNotFoundException ex){picker.onReceiveValue(null);picker=null;}
                return true;
            }
        });
        tts=new TextToSpeech(getApplicationContext(),status->{
            if(status==TextToSpeech.SUCCESS&&tts!=null){
                AudioAttributes mediaSpeech=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
                if(tts.setAudioAttributes(mediaSpeech)!=TextToSpeech.SUCCESS)return;
                Set<android.speech.tts.Voice> installed=tts.getVoices();
                if(installed!=null)for(android.speech.tts.Voice v:installed){
                    if("zh".equals(v.getLocale().getLanguage())&&!v.isNetworkConnectionRequired()
                        &&!v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)){
                        canSpeak=tts.setVoice(v)==TextToSpeech.SUCCESS;if(canSpeak)break;
                    }
                }
                tts.setSpeechRate(1.02f);
            }
        });
        updateCameraEdge();
        web.loadUrl("https://"+HOST+"/index.html");
    }
    private void grantCamera(PermissionRequest req){req.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});}
    @Override public void onRequestPermissionsResult(int code,String[] perms,int[] result){
        super.onRequestPermissionsResult(code,perms,result);
        if(code==10&&pendingCamera!=null){if(result.length>0&&result[0]==PackageManager.PERMISSION_GRANTED)grantCamera(pendingCamera);else pendingCamera.deny();pendingCamera=null;}
    }
    @Override public void onActivityResult(int code,int result,Intent data){
        super.onActivityResult(code,result,data);
        if(code==11&&picker!=null){picker.onReceiveValue(result==RESULT_OK&&data!=null&&data.getData()!=null?new Uri[]{data.getData()}:null);picker=null;}
    }
    public final class Phone {
        @JavascriptInterface public boolean analyzeScene(int ticket,String jpeg){return sceneCoach.request(ticket,jpeg);}
        @JavascriptInterface public void cancelScene(){sceneCoach.pause();}
        @JavascriptInterface public void setGuideMotion(boolean enabled){runOnUiThread(()->gravity.enable(enabled));}
        @JavascriptInterface public String guideTilt(){return gravity.read();}
        private Uri lastSaved;
        private byte[] lastDigest;
        @JavascriptInterface public String cameraEdge(){return cameraEdgeState;}
        @JavascriptInterface public boolean speak(String text){
            if(!canSpeak||text.length()>180||tts==null)return false;
            return tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,"coach")==TextToSpeech.SUCCESS;
        }
        @JavascriptInterface public void quiet(){if(tts!=null)tts.stop();}
        @JavascriptInterface public boolean requiresShutterSound(){
            return android.os.Build.VERSION.SDK_INT>=33&&MediaActionSound.mustPlayShutterSound();
        }
        @JavascriptInterface public void playRequiredShutter(){
            if(!requiresShutterSound())return;
            runOnUiThread(()->{
                if(isDestroyed())return;
                if(requiredSound==null)requiredSound=new MediaActionSound();
                requiredSound.play(MediaActionSound.SHUTTER_CLICK);
            });
        }
        @JavascriptInterface public void alignedPulse(){
            runOnUiThread(()->{
                if(web!=null&&web.hasWindowFocus())web.performHapticFeedback(
                    android.os.Build.VERSION.SDK_INT>=30?android.view.HapticFeedbackConstants.CONFIRM:
                    android.view.HapticFeedbackConstants.CLOCK_TICK);
            });
        }
        @JavascriptInterface public boolean saveJpeg(String data){return storePhoto(data)!=null;}
        private synchronized Uri storePhoto(String data){
            if(data==null||data.length()>20000000)return null;
            Uri uri=null;
            try{
                byte[] bytes=Base64.decode(data,Base64.DEFAULT);
                if(bytes.length<3||bytes[0]!=(byte)255||bytes[1]!=(byte)216)return null;
                byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(bytes);
                if(lastSaved!=null&&Arrays.equals(digest,lastDigest)){
                    try(android.os.ParcelFileDescriptor fd=getContentResolver().openFileDescriptor(lastSaved,"r")){
                        if(fd!=null)return lastSaved;
                    }catch(IOException|SecurityException unavailable){lastSaved=null;}
                }
                ContentValues v=new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME,"CuddlePose-"+System.currentTimeMillis()+".jpg");
                v.put(MediaStore.Images.Media.MIME_TYPE,"image/jpeg");
                v.put(MediaStore.Images.Media.RELATIVE_PATH,"Pictures/CuddlePose");v.put(MediaStore.Images.Media.IS_PENDING,1);
                uri=getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,v);
                if(uri==null)return null;
                try(OutputStream out=getContentResolver().openOutputStream(uri)){if(out==null)throw new IOException();out.write(bytes);}
                v.clear();v.put(MediaStore.Images.Media.IS_PENDING,0);
                if(getContentResolver().update(uri,v,null,null)!=1)throw new IOException();
                lastSaved=uri;lastDigest=digest;return uri;
            }catch(Exception err){if(uri!=null)getContentResolver().delete(uri,null,null);return null;}
        }

    }
    @Override public void onStop(){getSystemService(DisplayManager.class).unregisterDisplayListener(displayListener);started=false;sceneCoach.pause();gravity.enable(false);super.onStop();if(web!=null)web.evaluateJavascript("window.pauseCapture?.()",null);if(tts!=null)tts.stop();}
    @Override public void onStart(){super.onStart();started=true;getSystemService(DisplayManager.class).registerDisplayListener(displayListener,null);updateCameraEdge();if(web!=null)web.evaluateJavascript("window.resumeCapture?.()",null);}
    @Override public void onDestroy(){sceneCoach.close();if(tts!=null){canSpeak=false;tts.shutdown();}if(web!=null){web.removeJavascriptInterface("Phone");web.destroy();}if(requiredSound!=null)requiredSound.release();super.onDestroy();}
}

final class GuideAngles {
    static String fromDisplay(float x,float y,float z,int rotation){
        float right=x,up=y;
        if(rotation==Surface.ROTATION_90){right=-y;up=x;}
        else if(rotation==Surface.ROTATION_180){right=-x;up=-y;}
        else if(rotation==Surface.ROTATION_270){right=y;up=-x;}
        double vertical=Math.hypot(right,up);
        if(vertical<3||up<=0)return "";
        return Math.atan2(right,up)+","+Math.atan2(z,vertical);
    }
}
