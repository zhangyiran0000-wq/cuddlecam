// Roles belong to positions in the reference. Mirroring moves both the role and its target.
export function holderIndex(pose){return ['forehead','brow-3'].includes(pose.id)?1:0;}
export function brief(pose){
  if(pose.id==='forehead')return '拿手机的人稳住，另一位稍高一点，低头靠近对方的额头。';
  if(pose.id==='kiss')return '拿手机的人稳住镜头。两人把脸转向对方，慢慢靠近。';
  if(pose.id==='brow-3')return '拿手机的人稳住，另一位低头，靠近对方的发际。';
  if(pose.family==='hand'||pose.family==='play'){
    if(!/拿手机|另一位|两人/.test(pose.setup))return '另一位'+pose.setup;
  }
  return pose.setup;
}
export const lines={
  'phone-back':'拿手机的人，把手机拿远一点。',
  'phone-center':'拿手机的人，把镜头移向两人中间。',
  'phone-lower':'拿手机的人，把镜头往下移一点。',
  'phone-raise':'拿手机的人，把镜头往上移一点。',
  'phone-nearer':'拿手机的人，把手机拿近一点。',
  'partner-closer':'拿手机的人稳住，另一位再靠近一点。',
  'invite-kiss':'可以亲了。','invite-temples':'现在，轻轻抵住额头。','invite-nose':'现在，轻轻碰一下鼻尖。',
  'hold-still':'两位保持一下。'
};
for(const [who,label] of [['holder','拿手机的人'],['partner','另一位']]){
  for(const [action,words] of Object.entries({in:'把脸转向对方一点。',out:'把脸向外侧转一点。',front:'把脸转向镜头一点。',tilt:'向对方轻轻歪头。',away:'向外侧轻轻歪头。',straight:'把头扶正一点。',up:'把头稍微抬高一点。',down:'把头稍微放低一点。'})){
    lines[who+'-'+action]=label+'，'+words;
  }
}
export function instruction(a,pose){
  const key=a.cue,actor=a.actor??0,who=actor===holderIndex(pose)?'holder':'partner';
  if(['back','center','lower','raise','nearer'].includes(key))return 'phone-'+key;
  if(key==='closer')return 'partner-closer';
  if(key==='height')return who+'-'+(a.tooLow?'up':'down');
  if(key==='turn')return who+'-'+a.turnAction;
  if(key==='hand')return 'pose-'+pose.id;
  if(key==='hold')return 'hold-still';
  return key;
}
export const invitations={lip:'invite-kiss',brow:'invite-kiss',sidekiss:'invite-kiss',temples:'invite-temples',nose:'invite-nose'};
