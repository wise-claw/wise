# SWE-bench Verified Results

## Summary

| Mode | Pass Rate | Avg Tokens | Avg Time | Total Cost |
|------|-----------|------------|----------|------------|
| Vanilla | -% | - | -m | $- |
| WISE | -% | - | -m | $- |

**Delta:** - percentage points improvement

## Methodology

### Dataset

- **Benchmark:** SWE-bench Verified (500 instances)
- **Source:** princeton-nlp/SWE-bench_Verified
- **Selection:** Curated subset of real GitHub issues with verified solutions

### Evaluation Setup

- **Model:** Claude Sonnet 4.6 (claude-sonnet-4-6-20260217)
- **Max Tokens:** 16,384 output tokens per instance
- **Timeout:** 30 minutes per instance
- **Workers:** 4 parallel evaluations
- **Hardware:** [Specify machine type]

### Vanilla Configuration

Standard Claude Code with default settings:
- No WISE extensions loaded
- Default system prompt
- Single-agent execution

### WISE Configuration

Wise enhanced with:
- Multi-agent orchestration
- Specialist delegation (architect, executor, etc.)
- Ralph persistence loop for complex tasks
- Ultrawork parallel execution
- Automatic skill invocation

### Metrics Collected

1. **Pass Rate:** Percentage of instances where generated patch passes all tests
2. **Token Usage:** Input + output tokens consumed per instance
3. **Time:** Wall-clock time from start to patch generation
4. **Cost:** Estimated API cost based on token usage

## Results Breakdown

### By Repository

| Repository | Vanilla | WISE | Delta |
|------------|---------|-----|-------|
| django | -/- | -/- | - |
| flask | -/- | -/- | - |
| requests | -/- | -/- | - |
| ... | ... | ... | ... |

### By Difficulty

| Difficulty | Vanilla | WISE | Delta |
|------------|---------|-----|-------|
| Easy | -% | -% | - |
| Medium | -% | -% | - |
| Hard | -% | -% | - |

### Failure Analysis

Top failure categories for each mode:

**Vanilla:**
1. Category: N failures (N%)
2. ...

**WISE:**
1. Category: N failures (N%)
2. ...

## Improvements

Instances that WISE solved but vanilla failed:

| Instance ID | Category | Notes |
|-------------|----------|-------|
| ... | ... | ... |

## Regressions

Instances that vanilla solved but WISE failed:

| Instance ID | Category | Notes |
|-------------|----------|-------|
| ... | ... | ... |

## Reproduction

### Prerequisites

```bash
# Install SWE-bench
pip install swebench

# Install wise (if testing WISE)
# Follow setup instructions in main README
```

### Running Vanilla Baseline

```bash
# Generate predictions
python run_benchmark.py --mode vanilla --dataset swe-bench-verified --output results/vanilla/

# Evaluate
python evaluate.py --predictions results/vanilla/predictions.json --output results/vanilla/
```

### Running WISE

```bash
# Generate predictions with WISE
python run_benchmark.py --mode wise --dataset swe-bench-verified --output results/wise/

# Evaluate
python evaluate.py --predictions results/wise/predictions.json --output results/wise/
```

### Comparing Results

```bash
python compare_results.py --vanilla results/vanilla/ --wise results/wise/ --output comparison/
```

### Analyzing Failures

```bash
python analyze_failures.py --vanilla results/vanilla/ --wise results/wise/ --compare --output analysis/
```

## Files

```
results/
├── vanilla/
│   ├── predictions.json      # Generated patches
│   ├── summary.json          # Evaluation summary
│   ├── report.md             # Human-readable report
│   └── logs/                 # Per-instance logs
├── wise/
│   ├── predictions.json
│   ├── summary.json
│   ├── report.md
│   └── logs/
├── comparison/
│   ├── comparison_*.json     # Detailed comparison data
│   ├── comparison_*.md       # Comparison report
│   └── comparison_*.csv      # Per-instance CSV
└── analysis/
    ├── failure_analysis_*.json
    └── failure_analysis_*.md
```

## Notes

- Results may vary based on API model version and temperature
- Some instances may have non-deterministic test outcomes
- Cost estimates are approximate based on published pricing

## References

- [SWE-bench Paper](https://arxiv.org/abs/2310.06770)
- [SWE-bench Repository](https://github.com/princeton-nlp/SWE-bench)
- [Wise Documentation](../README.md)

---

*Last updated: [DATE]*
