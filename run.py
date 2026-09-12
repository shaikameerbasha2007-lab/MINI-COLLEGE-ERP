import subprocess
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # linkingfols/nothing/students
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))

# Students app (5000)
subprocess.Popen(
    ["python", "app.py"],
    cwd=BASE_DIR
)

# Assignment app (5001)
subprocess.Popen(
    ["python", "app.py"],
    cwd=os.path.join(ROOT_DIR, "assignment")
)

# Registration app (5003)
subprocess.Popen(
    ["python", "app.py"],
    cwd=os.path.join(ROOT_DIR, "registration")
)
subprocess.Popen(
    ["python", "server.py"],
    cwd=os.path.join(ROOT_DIR, "attendance")
)
