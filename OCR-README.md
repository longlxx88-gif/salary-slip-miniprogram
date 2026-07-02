# OCR 配置与识别效果优化

这版云函数会优先使用 Azure Document Intelligence `prebuilt-layout`，更适合倾斜拍摄、表格密集、中文/英文/泰文混排的工资条。没有配置 Azure 时，仍自动回退到腾讯云 `RecognizeTableAccurateOCR`。

## 推荐配置

在微信云开发 `ocr` 云函数环境变量中配置：

- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`
- `AZURE_DOCUMENT_INTELLIGENCE_KEY`
- `AZURE_DOCUMENT_INTELLIGENCE_API_VERSION`，可选，默认 `2024-11-30`

腾讯云兜底配置仍保留：

- `TENCENT_SECRET_ID`
- `TENCENT_SECRET_KEY`
- `TENCENT_REGION`，默认 `ap-guangzhou`

## 本次改进

- 前端优先上传原图到云存储，并把临时 URL 传给云函数。
- 只有图片超过约 4MB 时才温和压缩，避免工资条小字被压糊。
- 云函数优先调用 Azure Layout 表格识别，未配置 Azure 时回退腾讯云 TableOCR。
- OCR 结果会写入云数据库 `ocr_results`，当结果较小时仍直接返回完整单元格；当结果较大时只返回 `recordId` 和摘要，前端会自动二次查询完整结果。
- 解析阶段优先按表格行列配对，并过滤银行账号、公司地址、发薪周期等非工资字段。

## 云开发数据库

建议在云开发控制台创建集合 `ocr_results`，用于保存完整 OCR 识别结果。集合权限建议设置为仅管理员/云函数可写，客户端不直接读集合，而是通过 `ocr` 云函数按调用者 openid 校验后读取，避免工资条原始识别结果泄露。

如果集合不存在或写入失败，云函数会退回旧流程直接返回 OCR 结果，不会阻断当前识别展示逻辑。

由于识别后会多一次数据库写入，大图/复杂表格建议将 `ocr` 云函数超时时间调整到 30 秒。

## 拍摄建议

- 工资条尽量铺平，画面中工资条占比越大越好。
- 避免反光和强阴影。
- 如果纸张旋转明显，先在相册中旋正后再上传，识别会更稳。
