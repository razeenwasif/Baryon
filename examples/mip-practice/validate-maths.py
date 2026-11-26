"""Small exhaustive checks supporting the independently prepared answer key."""
from itertools import product,combinations
import json
assignments=list(product([0,1],repeat=3)); clauses=list(product([False,True],repeat=3)); cases=0
for size in range(1,9):
 for formula in combinations(clauses,size):
  for x in assignments:
   literals=[[x[i] if positive else 1-x[i] for i,positive in enumerate(clause)] for clause in formula]
   sat=all(any(row) for row in literals)
   c1=all(sum(row)>=1 for row in literals)
   c2=sum(map(sum,literals))>=len(formula)
   assert sat==c1
   assert not c1 or c2
   cases+=1
# Constraint 4 excludes a satisfying assignment of a negative clause.
x=(0,0,0);assert any(1-v for v in x) and sum(x)<3
# Constraint 2 alone permits an entirely false clause when another has >=2 true literals.
assert sum([0,0,0,1,1,1])>=2
# Original max formulation permits every bounded point by selecting an argmax.
points=0;wrong_a=0;wrong_b=0;nonnegative_b_failures=0
for l1,l2,d1,d2 in product(range(-3,3),range(-3,3),range(1,4),range(1,4)):
 lower=[l1,l2];upper=[l1+d1,l2+d2];M=max(upper)
 for x in product(range(lower[0],upper[0]+1),range(lower[1],upper[1]+1)):
  y=max(x);selected=x.index(y)
  assert all(y>=x[j] and y<=x[j]+(M-lower[j])*(j!=selected) for j in range(2))
  a=all(y<=x[j]+(upper[j]-lower[j])*(j!=selected) for j in range(2))
  b=all(y<=x[j]+M*(j!=selected) for j in range(2))
  wrong_a+=not a;wrong_b+=not b
  if min(lower)>=0:nonnegative_b_failures+=not b
  points+=1
assert wrong_a and wrong_b and not nonnegative_b_failures
# Explicit counterexamples used in the answer key.
assert 10>0+(1-0) # A: x1=0, x2=10; bounds [0,1], [0,10].
assert 3>-5+3 and 3<=-5+(3-(-5)) # B: negative lower bound.
# Minimum over disjoint-node lower bounds is valid; maximum need not be.
lower_bounds=[2,8];node_optima=[5,9]
assert min(lower_bounds)<=min(node_optima)<max(lower_bounds)
result=dict(sat_assignment_formula_cases=cases,max_formulation_grid_points=points,student_a_excluded_valid_points=wrong_a,student_b_excluded_valid_points=wrong_b,student_b_failures_with_nonnegative_lower_bounds=nonnegative_b_failures,status='PASS')
print(json.dumps(result,indent=2))
