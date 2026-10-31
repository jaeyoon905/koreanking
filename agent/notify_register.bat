@echo off
rem Register daily 08:00 expiry notification task (run once as the user who should receive it)
schtasks /Create /F /SC DAILY /TN LabelCoastNotify /TR "python -X utf8 \"%~dp0notify.py\"" /ST 08:00
