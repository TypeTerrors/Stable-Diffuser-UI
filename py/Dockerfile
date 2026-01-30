# syntax=docker/dockerfile:1

#
# NOTE: DGX Spark ships with the 580.xx driver branch (CUDA 13.0). Using an NGC
# image built on CUDA 13.1 (e.g. 26.01) triggers CUDA Forward Compatibility mode
# and prints a driver/kernel mismatch warning at startup. Defaulting to 25.09
# (CUDA 13.0) avoids the warning on 580.xx hosts.
#
ARG PYTORCH_BASE_IMAGE=nvcr.io/nvidia/pytorch:25.09-py3
FROM ${PYTORCH_BASE_IMAGE}
WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --no-deps vllm

COPY . .

CMD [ "python" , "-m", "main.py" ]
