# syntax=docker/dockerfile:1

#
# NOTE: DGX Spark ships with the 580.xx driver branch (CUDA 13.0). Using an NGC
# image built on CUDA 13.1 (e.g. 26.01) triggers CUDA Forward Compatibility mode
# and prints a driver/kernel mismatch warning at startup. Defaulting to 25.09
# (CUDA 13.0) avoids the warning on 580.xx hosts.
#
# vLLM pip wheels commonly target CUDA 12 and can fail to import in CUDA 13
# containers (e.g. missing libcudart.so.12). Prefer NVIDIA's vLLM image on Spark
# so the bundled vLLM extension matches the CUDA runtime.
#
ARG PY_BASE_IMAGE=nvcr.io/nvidia/vllm:25.09-py3
FROM ${PY_BASE_IMAGE}
WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD [ "python" , "-m", "main.py" ]
