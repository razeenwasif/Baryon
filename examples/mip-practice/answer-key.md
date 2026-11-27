# MIP practice quiz — independent answer key

Kept separate from the HTML and never supplied to Fairy during the live test.
Question 6 uses the confirmed interpretation: remove the negative lower-bound
term from M, leaving `max_i(over(xi))`.

| Question | Expected result |
|---|---|
| 1 | Third option: **1 and 3**. |
| 2 | Constraints 1 and 3 enforce satisfaction of each clause and consistent literal values. Constraint 2 follows by summing the clause constraints, while constraint 4 incorrectly forces every Boolean variable to be true. |
| 3 | The integer feasible points encode satisfying assignments, so deciding whether their exact convex hull is empty decides 3-SAT. Computing a polynomial-size exact hull description in polynomial time would therefore give a polynomial-time method for an NP-complete problem; hull descriptions can also be exponentially large. |
| 4 | **No**. |
| 5 | `over(xj)` need not bound the other variables, so the proposed smaller M can exclude valid solutions. For example, bounds [0,1] and [0,10] with x1=0, x2=10 and u1=0 require y=10, but Student A’s constraint would require y≤1. |
| 6 | **No**, not for arbitrary signed lower bounds. |
| 7 | If `under(xj)` is negative, removing its subtraction makes M too small and can exclude a valid maximum. For example, `under(x1)=-5`, x1=-5 and x2=y=`max_i(over(xi))`=3 with u1=0 would require 3≤−2 after the removal, whereas the original bound permits y=3. |
| 8 | Third option: **It is used to find feasible solutions that may not necessarily be optimal**. |
| 9 | The feasibility pump is a primal heuristic that seeks an integer-feasible solution, without guaranteeing success or optimality. A solution it finds can improve the incumbent upper bound in minimization, allowing Branch and Bound to prune more nodes. |
| 10 | Any remaining better solution must lie in an open node, and each node’s bound applies only to its own subproblem, so the smallest node lower bound bounds every remaining candidate. Comparing this global lower bound with the incumbent upper bound gives a valid optimality gap. |
| 11 | **No**, in the usual mathematical sense of strengthening the relaxation. |
| 12 | The exact integer hull already gives the ILP’s optimal value through linear optimization and has integer vertices. Every valid Gomory cut is redundant for that hull, so it cannot tighten the bound or remove a fractional vertex. |

## Qualifications

- Q6: Removing the term can be valid when all lower bounds are nonnegative (and is unchanged when they are zero); the lecture allows arbitrary bounded real variables, so the general claim is false.
- Q10: Formally the global lower bound is `min(incumbent, min(open-node lower bounds))`; conventional Branch and Bound prunes nodes dominated by the incumbent. An empty open-node set terminates the search.
- Q11–12: An integer hull can contain fractional non-vertex points. The reason cuts do not strengthen it is that valid linear inequalities hold for every convex combination of integer feasible points, not that every point in the hull is integer. Numerical effects from adding redundant constraints are not a theoretical improvement to the relaxation.
- The two-sentence suggested answers comply with the listed 100-word and 50-word limits.

## Verification

`validate-maths.py` exhaustively checks 2,040 assignments/formula combinations over
three Boolean variables, and 2,916 bounded max-formulation grid points. It verifies
the original max constraints and finds counterexamples to both proposed changes.
These are finite supporting checks; the arguments above establish the general claims.

The feasibility-pump description was checked against [SCIP’s implementation documentation](https://www.scipopt.org/doc/html/heur__feaspump_8h.php).
The integer-hull/cutting-plane distinction is consistent with [MIT’s Gomory–Chvátal closure research](https://dspace.mit.edu/entities/publication/a3d32c36-384c-47fb-b965-cec02615e0b1).


## Added topics (questions 13–24)
These are original practice questions; the answer key is never embedded in the quiz or sent to the model.

13. Position 2: theta >= 6 - 2x. Dual feasible multiplier 2 gives the affine lower bound.
14. Q(x) = max(0, 6-2x). Weak duality makes the cut globally valid; its negative values for x>3 remain lower bounds, not exact values.
15. Yes: y in [0,1] with y>=3-x is feasible exactly when x>=2.
16. False: at x=4 the single cut permits theta=-2, while Q(4)=0.
17. Position 2: 4 - (2*1 + 1*3) = -1.
18. Negative reduced cost violates the omitted dual constraint, so this column is a pricing candidate; degeneracy means adding it need not strictly reduce the primal objective immediately.
19. False: exact pricing certifies the full LP only; integrality remains unresolved.
20. Position 3: 12 is an LP lower bound on a feasible minimization integer program.
21. Position 2: (1,1), objective 2, by strict convexity and KKT.
22. L=x^2+y^2+mu(2-x-y), mu=2; stationarity, feasibility and complementary slackness hold. Convexity makes KKT sufficient, and strict convexity makes the minimizer unique.
23. True: a lower feasible value would produce arbitrarily nearby better values along a convex combination, contradicting local optimality.
24. Yes: upward quadratic arc. The verification-only concave variant has the identical text but the inverted curve; its answer is No.

Sources used to check the underlying definitions (questions and numbers are original):
- SCIP Benders framework: https://www.scipopt.org/doc-6.0.2/html/BENDDECF.php
- SCIP pricing documentation: https://www.scipopt.org/doc/html/PRICER.php
- Boyd and Vandenberghe, Convex Optimization: https://web.stanford.edu/~boyd/cvxbook/
