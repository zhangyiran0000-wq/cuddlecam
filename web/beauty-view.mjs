import {drawSkinMask} from './retouch.mjs';

const vertex=`attribute vec2 pos;
varying vec2 uv;
void main(){uv=vec2(.5+.5*pos.x,.5-.5*pos.y);gl_Position=vec4(pos,0.,1.);}`;
const fragment=`precision highp float;
varying vec2 uv;
uniform sampler2D frame,mask;
uniform vec4 jaw0,jaw1;
uniform vec3 amount;
uniform float aspect;
vec2 delta(vec2 q,vec4 jaw){
  vec2 dir=jaw.zw-jaw.xy;
  float w=length(dir);
  if(w<.001)return vec2(0.);
  dir/=w;
  float pull=w*.083*amount.y;
  vec2 l=q-jaw.xy-pull*.5*dir,r=q-jaw.zw+pull*.5*dir;
  float rad=.32*w;
  vec2 weight=max(vec2(0.),1.-vec2(dot(l,l),dot(r,r))/(rad*rad));
  return dir*pull*(weight.y*weight.y-weight.x*weight.x);
}
void main(){
  vec2 scale=vec2(aspect,1.),q=uv*scale;
  float id=texture2D(mask,uv).b;
  vec2 warp=delta(q,jaw0)*(1.-smoothstep(.55,.82,id));
  warp+=delta(q,jaw1)*(1.-smoothstep(.15,.30,id)*(1.-smoothstep(.45,.65,id)));
  vec2 at=clamp(uv+warp/scale,0.,1.);
  vec3 m=texture2D(mask,at).rgb,col=texture2D(frame,at).rgb;
  if(m.r>.002){
    float faceWidth=m.b>.65?length(jaw1.zw-jaw1.xy):length(jaw0.zw-jaw0.xy);
    vec2 stepSize=vec2(.013*faceWidth)/scale;
    vec3 low=.2*(col+texture2D(frame,at+stepSize).rgb+texture2D(frame,at-stepSize).rgb+
      texture2D(frame,at+vec2(stepSize.x,-stepSize.y)).rgb+texture2D(frame,at+vec2(-stepSize.x,stepSize.y)).rgb);
    float edge=dot(col-low,vec3(.24,.65,.11))*255./14.;
    col=mix(col,low,m.r*.76*amount.z/(1.+edge*edge));
  }
  col+=amount.x*4.*col*(1.-col)*(m.r*vec3(14.,6.,3.)+m.g*vec3(13.,-4.,-1.))/255.;
  gl_FragColor=vec4(col,1.);
}`;

export function beautyView(layer,onUnavailable){
  const mask=document.createElement('canvas'),mc=mask.getContext('2d');
  let gl=null,program=null,videoTexture,maskTexture,uniforms,failed=false,lastSeen=0,lastDraw=0;
  const hide=()=>{layer.hidden=true;lastSeen=0;};
  function initialise(){
    gl=layer.getContext('webgl',{alpha:false,depth:false,stencil:false,antialias:false,preserveDrawingBuffer:false});
    if(!gl)throw Error('WebGL');
    function compile(type,source){
      const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;
    }
    program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(program,'pos');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    uniforms=Object.fromEntries(['frame','mask','aspect','jaw0','jaw1','amount'].map(k=>[k,gl.getUniformLocation(program,k)]));
    function texture(unit,name){
      gl.activeTexture(unit);const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
      for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);
      for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);
      gl.uniform1i(uniforms[name],unit-gl.TEXTURE0);return t;
    }
    videoTexture=texture(gl.TEXTURE0,'frame');maskTexture=texture(gl.TEXTURE1,'mask');
  }
  function unavailable(){hide();if(!failed)onUnavailable();failed=true;}
  layer.addEventListener('webglcontextlost',e=>{e.preventDefault();unavailable();});
  layer.addEventListener('webglcontextrestored',()=>{program=gl=null;failed=false;});
  function upload(unit,texture,source){
    gl.activeTexture(unit);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
  }
  return {hide,get failed(){return failed;},
    track(faces,source){
      if(failed||!faces.length){hide();return;}
      try{
        if(!program)initialise();
        const a=source.width/source.height,w=Math.round(320*Math.min(1,a)),h=Math.round(w/a);
        if(mask.width!==w||mask.height!==h){mask.width=w;mask.height=h;}
        mc.filter='none';mc.fillStyle='black';mc.fillRect(0,0,w,h);
        gl.uniform1f(uniforms.aspect,a);
        for(let i=0;i<2;i++){
          const mesh=faces[i]?.mesh,loc=i?uniforms.jaw1:uniforms.jaw0;
          if(!mesh){gl.uniform4f(loc,0,0,0,0);continue;}
          const points=mesh.map(p=>({x:p.x*w,y:p.y*h})),id=i?'ff':'55';
          drawSkinMask(mc,points,faces[i].width*w,'#ff00'+id,'#00ff'+id,'#0000'+id);
          gl.uniform4f(loc,mesh[172].x*a,mesh[172].y,mesh[397].x*a,mesh[397].y);
        }
        upload(gl.TEXTURE1,maskTexture,mask);lastSeen=performance.now();
      }catch{unavailable();}
    },
    draw(source,now,levels){
      if(!levels||failed||!lastSeen||now-lastSeen>560){hide();return;}
      if(now-lastDraw<30)return;
      try{
        lastDraw=now;
        const scale=Math.min(1,960/Math.max(source.width,source.height)),w=Math.round(source.width*scale),h=Math.round(source.height*scale);
        if(layer.width!==w||layer.height!==h){layer.width=w;layer.height=h;}
        gl.uniform3f(uniforms.amount,levels.tone/100,levels.slim/100,levels.smooth/100);
        gl.viewport(0,0,w,h);upload(gl.TEXTURE0,videoTexture,source);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);layer.hidden=false;
      }catch{unavailable();}
    }
  };
}
