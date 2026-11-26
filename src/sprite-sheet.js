// Find transparent seams between irregularly packed poses, once at load time.
// A narrow dynamic-programming band avoids cutting limbs at uniform cell edges.
export function spriteSeams(rgba,width,height,centers){
  const seams=[new Int16Array(height)];
  for(let i=0;i<centers.length-1;i++){
    const center=(centers[i]+centers[i+1])/2;
    const lo=Math.round(centers[i]+30),hi=Math.round(centers[i+1]-30),n=hi-lo+1;
    let prev=new Float64Array(n),next=new Float64Array(n);
    const parents=new Int16Array(n*height);
    for(let y=0;y<height;y++){
      for(let j=0;j<n;j++){
        const x=lo+j;let alpha=0;
        for(let d=-1;d<=1;d++)alpha=Math.max(alpha,rgba[(y*width+x+d)*4+3]||0);
        const cost=(alpha>24?1000+alpha:0)+Math.abs(x-center)*.02;
        let best=Infinity,parent=j;
        for(let k=Math.max(0,j-4);k<=Math.min(n-1,j+4);k++){
          const value=prev[k]+Math.abs(k-j)*.1;
          if(value<best){best=value;parent=k;}
        }
        next[j]=best+cost;parents[y*n+j]=parent;
      }
      [prev,next]=[next,prev];
    }
    let end=0;for(let j=1;j<n;j++)if(prev[j]<prev[end])end=j;
    const seam=new Int16Array(height);
    for(let y=height-1;y>=0;y--){seam[y]=lo+end;end=parents[y*n+end];}
    seams.push(seam);
  }
  seams.push(new Int16Array(height).fill(width));return seams;
}
