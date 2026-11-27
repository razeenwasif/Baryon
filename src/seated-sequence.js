// A seated session alternates playful gestures with longer quiet rests.
export const SEATED_KINDS=['finger','chin','peek'];
export function seatedPose(time,out={}){
 const t=Math.max(0,time)%66;let kind='chin',frame=0;
 if(t<8){kind='finger';frame=Math.min(4,Math.floor(t/1.6));}
 else if(t>=33&&t<41){kind='peek';const p=t-33;frame=p<1?0:p<1.7?1:p<2.4?2:p<3.5?3:p<4.8?4:p<5.8?5:p<6.7?6:7;}
 out.kind=kind;out.frame=frame;return out;
}
