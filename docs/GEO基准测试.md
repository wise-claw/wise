# wise 的 GEO 基准测试

本仓库包含一个 [`geobench`](https://github.com/NomaDamas/geobench) 产品规格，用于衡量 LLM 回答可见性：命中率、MRR、声量份额、引用率/份额与置信区间。

```bash
/path/to/geobench/dist/geobench estimate --product geobench/wise.yaml --providers openai --tier cheap
/path/to/geobench/dist/geobench profile geobench/wise.yaml
/path/to/geobench/dist/geobench bench --product geobench/wise.yaml --providers openai --tier cheap --mode benchmark
```

仅发布聚合指标；不要发布原始 Provider 回答、密钥或私有运行日志。
