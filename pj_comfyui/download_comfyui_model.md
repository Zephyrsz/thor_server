# ComfyUI 模型下载脚本使用说明

`download_comfyui_model.py` 用于从 Hugging Face 下载 ComfyUI 工作流需要的模型文件，并将文件放入对应的 ComfyUI 模型目录。

脚本支持：

- 接受 Hugging Face 的 `blob`、`resolve` 和带 `#:~:text=` 的 `tree` 页面链接。
- 自动预处理原始 URL、Markdown 链接以及中英文引号或反引号包装的链接。
- 统一将支持的输入转换为可下载的 `resolve` 链接。
- 根据 URL 路径自动识别 `diffusion_models`、`text_encoders`、`vae`、`loras` 等模型类型。
- 默认下载到 `/app/pj_comfyui/ComfyUI/models/<模型类型>/`。
- 跳过已经存在的模型，或使用 `--force` 强制重新下载。
- 使用 Hugging Face Xet 后端进行高速、可恢复的下载。
- 支持一个命令下载多个链接或从文本文件批量下载。
- 支持需要授权的私有仓库和 gated 模型。

## 脚本位置

远端服务器上的脚本：

```text
/app/pj_comfyui/download_comfyui_model.py
```

查看完整命令帮助：

```bash
/app/pj_comfyui/download_comfyui_model.py --help
```

## 基本用法

将 Hugging Face 文件链接作为参数传给脚本：

```bash
/app/pj_comfyui/download_comfyui_model.py "HUGGING_FACE_FILE_URL"
```

建议始终用引号包住整个输入，避免 `#`、`&` 等特殊字符被 Shell 解析。

每个输入可以是原始 URL，也可以是从聊天工具复制的 Markdown 链接：

```text
https://huggingface.co/owner/repository/blob/main/model.safetensors
[模型文件](https://huggingface.co/owner/repository/blob/main/model.safetensors)
‘[模型文件](https://huggingface.co/owner/repository/blob/main/model.safetensors)’
```

## 转换 tree 页面链接

浏览器复制的 Hugging Face 仓库页面链接可能使用 `tree` 路径，并通过
`#:~:text=` 标出文件名，例如：

```text
https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/tree/main#:~:text=flux1%2Dkontext%2Ddev.safetensors
```

脚本会提取仓库、版本和文件名，并统一转换为：

```text
https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/resolve/main/flux1-kontext-dev.safetensors
```

该页面链接本身没有 ComfyUI 模型目录信息，因此需要显式指定模型类型。可先
使用 `--dry-run` 检查转换结果，不会下载文件：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  'https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/tree/main#:~:text=flux1%2Dkontext%2Ddev.safetensors' \
  --model-type diffusion_models \
  --dry-run
```

输出应包含：

```text
Resolve URL: https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/resolve/main/flux1-kontext-dev.safetensors
Model type: diffusion_models
Output: /app/pj_comfyui/ComfyUI/models/diffusion_models/flux1-kontext-dev.safetensors
Dry run:    no file downloaded
```

确认无误后去掉 `--dry-run` 即可下载。该仓库是 gated 仓库时，仍需先接受
仓库协议并通过 `HF_TOKEN` 提供有读取权限的 Token。

## 下载 Z-Image 模型

例如，下载下面的 Z-Image 模型：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  "https://huggingface.co/Comfy-Org/z_image_turbo/blob/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors"
```

脚本会自动将链接转换为：

```text
https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors
```

因为 URL 中包含 `diffusion_models`，文件会自动保存到：

```text
/app/pj_comfyui/ComfyUI/models/diffusion_models/z_image_turbo_bf16.safetensors
```

## 下载前检查目录映射

使用 `--dry-run` 可以查看转换后的链接和目标路径，不会下载文件：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  "https://huggingface.co/Comfy-Org/z_image_turbo/blob/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors" \
  --dry-run
```

输出中应包含类似内容：

```text
Resolve URL: https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors
Model type: diffusion_models
Output: /app/pj_comfyui/ComfyUI/models/diffusion_models/z_image_turbo_bf16.safetensors
Dry run: no file downloaded
```

## 手动指定模型类型

如果 Hugging Face URL 的路径中没有模型类型，脚本无法安全判断目标目录。此时使用 `--model-type`：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  "https://huggingface.co/owner/repository/blob/main/model.safetensors" \
  --model-type vae
```

文件将保存到：

```text
/app/pj_comfyui/ComfyUI/models/vae/model.safetensors
```

常用模型类型如下：

| 模型类型 | ComfyUI 目标目录 |
| --- | --- |
| `checkpoints` | `models/checkpoints/` |
| `diffusion_models` | `models/diffusion_models/` |
| `text_encoders` | `models/text_encoders/` |
| `vae` | `models/vae/` |
| `vae_approx` | `models/vae_approx/` |
| `loras` | `models/loras/` |
| `controlnet` | `models/controlnet/` |
| `clip` | `models/clip/` |
| `clip_vision` | `models/clip_vision/` |
| `embeddings` | `models/embeddings/` |
| `unet` | `models/unet/` |
| `upscale_models` | `models/upscale_models/` |

脚本还支持 ComfyUI 当前安装中创建的其他模型目录。可通过以下命令查看全部有效值：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  "https://huggingface.co/owner/repository/blob/main/model.safetensors" \
  --model-type invalid \
  --dry-run
```

错误信息会列出全部支持的模型类型。

## 一次下载多个模型

可以在同一命令中传入多个 URL。每个 URL 会独立识别模型类型：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" \
  "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors" \
  "https://huggingface.co/Comfy-Org/z_image/resolve/main/split_files/diffusion_models/z_image_bf16.safetensors"
```

对应的目标目录分别为：

```text
models/vae/ae.safetensors
models/text_encoders/qwen_3_4b.safetensors
models/diffusion_models/z_image_bf16.safetensors
```

## 从 URL 文件批量下载

创建一个文本文件，例如 `missing-models.txt`：

```text
# Z-Image workflow models
https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors
https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors
https://huggingface.co/Comfy-Org/z_image/resolve/main/split_files/diffusion_models/z_image_bf16.safetensors
```

空行和以 `#` 开头的注释行会被忽略。执行：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  --url-file missing-models.txt
```

可以先批量检查映射：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  --url-file missing-models.txt \
  --dry-run
```

## 下载私有或 gated 模型

优先通过环境变量提供 Hugging Face Token，避免 Token 出现在 Shell 历史记录中：

```bash
export HF_TOKEN="hf_your_token"
/app/pj_comfyui/download_comfyui_model.py "HUGGING_FACE_FILE_URL"
```

脚本也支持 `HUGGING_FACE_HUB_TOKEN` 环境变量。

也可以通过参数传入，但不推荐在共享服务器上使用这种方式：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  "HUGGING_FACE_FILE_URL" \
  --token "hf_your_token"
```

## 已存在文件和强制下载

如果目标文件已经存在，脚本默认跳过：

```text
Status: already present; skipped
```

需要重新下载时使用：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  "HUGGING_FACE_FILE_URL" \
  --force
```

## 下载后端

### Hugging Face 后端

默认使用 Hugging Face Hub 和 Xet 后端，支持高速下载和中断后的继续下载：

```bash
/app/pj_comfyui/download_comfyui_model.py "HUGGING_FACE_FILE_URL"
```

等同于：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  "HUGGING_FACE_FILE_URL" \
  --backend hf
```

### aria2 后端

服务器安装了 `aria2c` 时，可以使用多连接下载：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  "HUGGING_FACE_FILE_URL" \
  --backend aria2 \
  --connections 16
```

如果服务器没有安装 `aria2c`，请继续使用默认的 `hf` 后端。

## 使用其他 ComfyUI 模型目录

默认模型根目录是：

```text
/app/pj_comfyui/ComfyUI/models
```

可以通过 `--models-dir` 覆盖：

```bash
/app/pj_comfyui/download_comfyui_model.py \
  "HUGGING_FACE_FILE_URL" \
  --models-dir /path/to/another/ComfyUI/models
```

## 下载结果验证

检查目标文件：

```bash
ls -lh /app/pj_comfyui/ComfyUI/models/diffusion_models/
ls -lh /app/pj_comfyui/ComfyUI/models/text_encoders/
ls -lh /app/pj_comfyui/ComfyUI/models/vae/
```

下载完成后，在 ComfyUI 页面刷新模型列表。如果对应 Loader 节点仍然看不到新模型，可以重启服务：

```bash
/app/pj_comfyui/start_comfyui.sh restart
```

重启会中断正在运行的工作流，执行前应确认任务队列为空。

## 参数速查

| 参数 | 说明 |
| --- | --- |
| `urls` | 一个或多个 Hugging Face `blob`、`resolve` 或 `tree#:~:text=` 链接 |
| `--url-file FILE` | 从文本文件读取 URL，每行一个 |
| `--models-dir DIR` | 覆盖 ComfyUI 模型根目录 |
| `--model-type TYPE` | 手动指定目标模型类型 |
| `--backend hf` | 使用默认 Hugging Face/Xet 后端 |
| `--backend aria2` | 使用 aria2 多连接下载 |
| `--connections N` | 设置 aria2 连接数，默认 16 |
| `--token TOKEN` | Hugging Face Token |
| `--force` | 强制重新下载已有文件 |
| `--dry-run` | 只显示 URL 转换和目标路径 |

## 常见问题

### 无法自动判断模型目录

错误示例：

```text
Error: cannot infer a ComfyUI model type from 'model.safetensors'; pass --model-type explicitly
```

原因是 URL 路径中没有 `vae`、`loras`、`diffusion_models` 等目录信息。根据工作流 Loader 节点的模型类型补充 `--model-type`。

### tree 页面链接无法识别

`tree` 页面链接必须包含一个非空的 `#:~:text=文件名`。如果页面链接没有该
片段、同时包含多个 `text` 候选，或候选值不是单个文件名，脚本会拒绝猜测。
请在浏览器中选中文件名后重新复制链接，或直接使用 Hugging Face 的 `blob`
文件链接。

### Hugging Face 返回 401 或 403

模型仓库需要登录授权、接受使用协议或 Token 没有读取权限。先在 Hugging Face 页面接受仓库协议，再设置 `HF_TOKEN`。

### 下载被中断

使用相同命令重新执行。默认 Hugging Face 后端会复用下载缓存并继续下载。不要手工移动 `models/.downloads` 中尚未完成的临时文件。

### 模型已下载但工作流仍提示缺失

检查以下内容：

1. 文件名是否与工作流 Loader 节点中选择的名称完全一致。
2. 模型是否位于正确的类型目录。
3. 文件大小是否正常，而不是错误页面或零字节文件。
4. 刷新 ComfyUI 模型列表，必要时在队列为空后重启服务。
