"""Independent numerical witnesses for the original added practice questions."""
from fractions import Fraction as F
import json
checks={}
xs=[F(i,20) for i in range(81)]
assert all(max(F(0),2*(3-x)) >= 6-2*x for x in xs)
assert max(F(0),2*(3-F(4)))==0 and 6-2*F(4)==-2
checks['benders_optimality_cut_and_counterexample']=True
assert all((max(F(0),3-x)<=1)==(x>=2) for x in xs)
checks['benders_feasibility_cut']=True
assert F(4)-(F(2)*1+F(1)*3)==-1
# With b=0, identity initial columns and a=(1,3), nonnegativity
# forces lambda=0 even after adding this negative-reduced-cost column.
assert all(not (u+t==0 and v+3*t==0) for u in range(5) for v in range(5) for t in range(1,5))
checks['reduced_cost_and_degeneracy_witness']=True
assert 2*F(1)-2==0 and 2-1-1==0
points=[(F(i,10),F(j,10)) for i in range(-30,51) for j in range(-30,51) if i+j>=20]
assert min(x*x+y*y for x,y in points)==2
assert [(x,y) for x,y in points if x*x+y*y==2]==[(F(1),F(1))]
checks['convex_quadratic_kkt_and_grid']=True
# SVG y coordinate runs downwards: first arc is convex in Cartesian coordinates.
assert -(35-2*375+35)>0 and -(200-2*(-140)+200)<0
checks['diagram_convex_and_concave_variants']=True
print(json.dumps({'passed':checks,'benders_grid':len(xs),'convex_grid_feasible':len(points)},indent=2))
