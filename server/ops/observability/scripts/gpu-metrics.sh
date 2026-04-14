#!/bin/bash
# GPU Metrics Exporter for Prometheus Node Exporter Textfile Collector
# Exports nvidia-smi metrics including fan speed which DCGM doesn't provide for consumer GPUs

OUTPUT_DIR="${1:-/var/lib/node_exporter/textfile_collector}"
OUTPUT_FILE="${OUTPUT_DIR}/gpu_metrics.prom"

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# Get GPU metrics from nvidia-smi
nvidia-smi --query-gpu=index,fan.speed,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw --format=csv,noheader,nounits 2>/dev/null | while IFS=', ' read -r index fan_speed temp gpu_util mem_util mem_used mem_total power; do
    # Clean up any whitespace
    index=$(echo "$index" | tr -d ' ')
    fan_speed=$(echo "$fan_speed" | tr -d ' ')
    temp=$(echo "$temp" | tr -d ' ')
    gpu_util=$(echo "$gpu_util" | tr -d ' ')
    mem_util=$(echo "$mem_util" | tr -d ' ')
    mem_used=$(echo "$mem_used" | tr -d ' ')
    mem_total=$(echo "$mem_total" | tr -d ' ')
    power=$(echo "$power" | tr -d ' ')

    # Write metrics in Prometheus format
    cat << METRICS
# HELP gpu_fan_speed_percent GPU fan speed percentage
# TYPE gpu_fan_speed_percent gauge
gpu_fan_speed_percent{gpu="${index}"} ${fan_speed}
METRICS
done > "${OUTPUT_FILE}.tmp"

# Atomic move to prevent partial reads
mv "${OUTPUT_FILE}.tmp" "${OUTPUT_FILE}"
