#!/bin/bash
# RAID Monitoring Script for Node Exporter Textfile Collector
# Outputs Prometheus-compatible metrics for RAID array status
# Run via cron: */5 * * * * /path/to/raid-metrics.sh > /var/lib/node-exporter/raid.prom

OUTPUT_FILE="${1:-/dev/stdout}"
TEMP_FILE=$(mktemp)

# Function to output metrics
write_metric() {
    echo "$1" >> "$TEMP_FILE"
}

# Header
write_metric "# HELP node_md_state MD RAID array state (1=active, 0=inactive/degraded)"
write_metric "# TYPE node_md_state gauge"
write_metric "# HELP node_md_disks_total Total disks in MD RAID array"
write_metric "# TYPE node_md_disks_total gauge"
write_metric "# HELP node_md_disks_active Active disks in MD RAID array"
write_metric "# TYPE node_md_disks_active gauge"
write_metric "# HELP node_md_disks_failed Failed disks in MD RAID array"
write_metric "# TYPE node_md_disks_failed gauge"
write_metric "# HELP node_md_disks_spare Spare disks in MD RAID array"
write_metric "# TYPE node_md_disks_spare gauge"
write_metric "# HELP node_md_sync_action Current sync action (0=idle, 1=resync, 2=recover, 3=check, 4=repair)"
write_metric "# TYPE node_md_sync_action gauge"
write_metric "# HELP node_md_sync_completed Sync completion percentage"
write_metric "# TYPE node_md_sync_completed gauge"

# Check if mdadm is available
if ! command -v mdadm &> /dev/null; then
    write_metric "# mdadm not found - no software RAID detected"
    mv "$TEMP_FILE" "$OUTPUT_FILE"
    exit 0
fi

# Check if /proc/mdstat exists
if [ ! -f /proc/mdstat ]; then
    write_metric "# /proc/mdstat not found - no software RAID configured"
    mv "$TEMP_FILE" "$OUTPUT_FILE"
    exit 0
fi

# Parse mdstat for RAID arrays
for md_device in /sys/block/md*/; do
    if [ -d "$md_device" ]; then
        device=$(basename "$md_device")

        # Get array state
        if [ -f "$md_device/md/array_state" ]; then
            state=$(cat "$md_device/md/array_state" 2>/dev/null)
            case "$state" in
                "active"|"clean"|"active-idle")
                    state_num=1
                    ;;
                *)
                    state_num=0
                    ;;
            esac
            write_metric "node_md_state{device=\"$device\",state=\"$state\"} $state_num"
        fi

        # Get disk counts from raid_disks and degraded
        if [ -f "$md_device/md/raid_disks" ]; then
            total_disks=$(cat "$md_device/md/raid_disks" 2>/dev/null || echo "0")
            write_metric "node_md_disks_total{device=\"$device\"} $total_disks"
        fi

        if [ -f "$md_device/md/degraded" ]; then
            degraded=$(cat "$md_device/md/degraded" 2>/dev/null || echo "0")
            active_disks=$((total_disks - degraded))
            write_metric "node_md_disks_active{device=\"$device\"} $active_disks"
            write_metric "node_md_disks_failed{device=\"$device\"} $degraded"
        fi

        # Get spare disks
        spare_count=0
        for dev_state in "$md_device/md/dev-"*/state; do
            if [ -f "$dev_state" ]; then
                if grep -q "spare" "$dev_state" 2>/dev/null; then
                    ((spare_count++))
                fi
            fi
        done
        write_metric "node_md_disks_spare{device=\"$device\"} $spare_count"

        # Get sync action
        if [ -f "$md_device/md/sync_action" ]; then
            sync_action=$(cat "$md_device/md/sync_action" 2>/dev/null || echo "idle")
            case "$sync_action" in
                "idle") sync_num=0 ;;
                "resync") sync_num=1 ;;
                "recover") sync_num=2 ;;
                "check") sync_num=3 ;;
                "repair") sync_num=4 ;;
                *) sync_num=0 ;;
            esac
            write_metric "node_md_sync_action{device=\"$device\",action=\"$sync_action\"} $sync_num"
        fi

        # Get sync completion
        if [ -f "$md_device/md/sync_completed" ]; then
            sync_completed=$(cat "$md_device/md/sync_completed" 2>/dev/null)
            if [ "$sync_completed" != "none" ] && [ -n "$sync_completed" ]; then
                # Format is "current / total"
                current=$(echo "$sync_completed" | cut -d'/' -f1 | tr -d ' ')
                total=$(echo "$sync_completed" | cut -d'/' -f2 | tr -d ' ')
                if [ "$total" -gt 0 ] 2>/dev/null; then
                    percent=$(echo "scale=4; $current / $total * 100" | bc 2>/dev/null || echo "0")
                    write_metric "node_md_sync_completed{device=\"$device\"} $percent"
                fi
            else
                write_metric "node_md_sync_completed{device=\"$device\"} 100"
            fi
        fi
    fi
done

# SMART disk health metrics
write_metric ""
write_metric "# HELP node_disk_smart_healthy Disk SMART health status (1=healthy, 0=failing)"
write_metric "# TYPE node_disk_smart_healthy gauge"
write_metric "# HELP node_disk_smart_temperature_celsius Disk temperature in Celsius"
write_metric "# TYPE node_disk_smart_temperature_celsius gauge"
write_metric "# HELP node_disk_smart_reallocated_sectors Count of reallocated sectors"
write_metric "# TYPE node_disk_smart_reallocated_sectors gauge"
write_metric "# HELP node_disk_smart_pending_sectors Count of current pending sectors"
write_metric "# TYPE node_disk_smart_pending_sectors gauge"

# Check SMART status for each disk
if command -v smartctl &> /dev/null; then
    for disk in /dev/sd? /dev/nvme?n1; do
        if [ -b "$disk" ]; then
            disk_name=$(basename "$disk")

            # Get SMART health
            smart_output=$(smartctl -H "$disk" 2>/dev/null)
            if echo "$smart_output" | grep -q "PASSED\|OK"; then
                write_metric "node_disk_smart_healthy{device=\"$disk_name\"} 1"
            elif echo "$smart_output" | grep -q "FAILED"; then
                write_metric "node_disk_smart_healthy{device=\"$disk_name\"} 0"
            fi

            # Get temperature
            temp=$(smartctl -A "$disk" 2>/dev/null | grep -i "temperature" | head -1 | awk '{print $(NF-0)}' | grep -oE '^[0-9]+')
            if [ -n "$temp" ]; then
                write_metric "node_disk_smart_temperature_celsius{device=\"$disk_name\"} $temp"
            fi

            # Get reallocated sectors (attribute 5)
            realloc=$(smartctl -A "$disk" 2>/dev/null | grep "Reallocated_Sector" | awk '{print $10}')
            if [ -n "$realloc" ]; then
                write_metric "node_disk_smart_reallocated_sectors{device=\"$disk_name\"} $realloc"
            fi

            # Get pending sectors (attribute 197)
            pending=$(smartctl -A "$disk" 2>/dev/null | grep "Current_Pending_Sector" | awk '{print $10}')
            if [ -n "$pending" ]; then
                write_metric "node_disk_smart_pending_sectors{device=\"$disk_name\"} $pending"
            fi
        fi
    done
fi

# Move temp file to output atomically
mv "$TEMP_FILE" "$OUTPUT_FILE"
