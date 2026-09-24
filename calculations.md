# Relative Weight Tool Calculations

This document outlines all calculations used in the Relative Weight Tool, including details about field names, operations, and sorting.

## Base Fields

The tool stores four fundamental values in the database:

1. **Benefit (B)**: The value gained by implementing a story (relative weight in agile Fibonacci: 1, 2, 3, 5, 8, 13, 21)
2. **Penalty (P)**: The cost of not implementing a story (relative weight in agile Fibonacci: 1, 2, 3, 5, 8, 13, 21)
3. **Estimate (E)**: The resources required to implement a story (relative weight in agile Fibonacci: 1, 2, 3, 5, 8, 13, 21)
4. **Risk (R)**: The uncertainty or complexity in implementation (relative weight in agile Fibonacci: 1, 2, 3, 5, 8, 13, 21)

## Calculated Fields

The following values are calculated at runtime and not stored in the database. All calculations can be performed for the entire dataset or filtered by feature to compute metrics for stories within a specific feature:

### Basic Calculations

```
Value = Benefit + Penalty
```
- Represents the total positive impact of implementing a story
- Combines both the direct value gained and the penalty avoided
- Used in priority calculations and for sorting stories

```
Cost = Estimate + Risk
```
- Represents the total resource investment required
- Combines estimated effort with risk-related overhead
- Higher risk increases the effective cost of a feature

```
Priority = Value / Cost
```
- The basic priority score indicates return on investment
- Higher values indicate more valuable features relative to their cost
- This value is used for ranking features in the prioritized list
- Formatted to 2 decimal places for display purposes

### Relative Weight Calculations

Relative weights normalize each story's values against the total sum of all stories:

```
Relative Benefit = Benefit / Sum of all Benefits
```
- Shows what share of total benefit this story provides (a fraction between 0 and 1)
- Helps identify the most beneficial stories in relation to others

```
Relative Penalty = Penalty / Sum of all Penalties
```
- Shows what share of total penalty avoidance this story provides (a fraction between 0 and 1)
- Identifies stories with the highest opportunity cost if not implemented

```
Relative Estimate = Estimate / Sum of all Estimates
```
- Shows what share of total effort this story will consume (a fraction between 0 and 1)
- Helps with resource allocation planning

```
Relative Risk = Risk / Sum of all Risks
```
- Shows what share of total risk this story represents (a fraction between 0 and 1)
- Identifies stories with disproportionate risk compared to others

Relative weights are reported to four significant digits, so small shares in
large backlogs don't round to 0. Tables show two decimals, and `<0.01` for a
share that is not zero but smaller than that.

### Weighted Calculations

The tool also supports weighted calculations where each factor can be given different importance:

```
Weighted Priority = (w1*Benefit + w2*Penalty) / (w3*Estimate + w4*Risk)
```

Where:
- w1: Benefit weight (default: 1.5)
- w2: Penalty weight (default: 1.5)
- w3: Estimate weight (default: 1.5)
- w4: Risk weight (default: 1.5)

Weights are set per project with `rw config weights --set --w1 … --w4 …` (MCP: `weight_set`), or given for a single run with `--w1`..`--w4` on `rw calc priority` (MCP: `calc_priority`), to emphasise different factors according to business priorities.

### Feature-Level Calculations

All of the above calculations can also be performed at the feature level:

- Stories can be filtered by their associated feature field
- Calculations are then performed on the filtered subset
- This allows comparing metrics between features
- Feature-level calculations follow the same formulas but only include stories within that feature
- Relative weights within a feature only consider other stories in the same feature
- This provides more granular analysis for decision-making

## Sorting

`rw ticket list --sort <field>` (MCP: `ticket_list` with `sort`) sorts tickets in descending order by any of these fields:

1. **Base Fields** (`benefit`, `penalty`, `estimate`, `risk`):
   - Sorted directly by their numeric values

2. **`value`**:
   - Calculated as `Benefit + Penalty`
   - Sorted by this calculated value

3. **`cost`**:
   - Calculated as `Estimate + Risk`
   - Sorted by this calculated value

4. **`priority`**:
   - Calculated as `Value / Cost`
   - Sorted by the exact ratio, not the rounded value shown

The database only stores the 4 base values (Benefit, Penalty, Estimate, Risk); the calculated fields are computed in memory after retrieving them. The dashboard (`rw report dashboard`) is a static page whose ticket table is sorted by priority.
