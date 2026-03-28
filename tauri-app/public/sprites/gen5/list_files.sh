#!/bin/bash

# Go to the script's own directory
cd "$(dirname "$0")" || exit 1

# Output filename
OUTFILE="BASE_SPRITES"

# Generate file list
ls -1 > "$OUTFILE"

# Confirm and show path
if [[ -f "$OUTFILE" ]]; then
  echo "File list generated and saved to: $(pwd)/$OUTFILE"
else
  echo "Error: File was not created."
fi
