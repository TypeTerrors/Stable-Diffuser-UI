# syntax=docker/dockerfile:1

FROM nvcr.io/nvidia/pytorch:26.01-py3
WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --no-deps vllm

COPY . .

CMD [ "python" , "-m", "main.py" ]
