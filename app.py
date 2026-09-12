from flask import Flask, render_template, request, jsonify, redirect, url_for, session, flash, send_file, send_from_directory
from werkzeug.utils import secure_filename
from flask_cors import CORS
import json
import os
import sys
import sqlite3
import time
from datetime import datetime
import pdfkit
import subprocess
import webbrowser


CONFIG_FILE = 'config.json'

CONFIG_FILE = 'config.json'

def get_faculty_password():
    try:
        with open(CONFIG_FILE, 'r') as f:
            data = json.load(f)
        return data.get('faculty_password', '1359')  # Default password if not set
    except FileNotFoundError:
        # If config file doesn't exist, create it with default password
        set_faculty_password('1359')
        return '1359'

def set_faculty_password(new_password):
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump({"faculty_password": new_password}, f)
        return True
    except Exception as e:
        print(f"Error saving password: {str(e)}")
        return False


app = Flask(__name__)
CORS(app)
app.secret_key = "supersecret"

# Configuration paths
DB_PATH = "database/school.db"
UPLOAD_FOLDER = "static/uploads"
NOTICE_FOLDER = "static/notices"
OUTPUT_FOLDER = "output"
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
DATA_FILE = os.path.abspath("attendance_data.json")
ATTENDANCE_FOLDER = "static/attendance"


# Configure PDFKit
PDFKIT_CONFIG = pdfkit.configuration(wkhtmltopdf=r"C:\\Program Files\\wkhtmltopdf\\bin\\wkhtmltopdf.exe")

# App config
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['NOTICE_FOLDER'] = NOTICE_FOLDER
app.config['ATTENDANCE_FOLDER'] = ATTENDANCE_FOLDER
os.makedirs(ATTENDANCE_FOLDER, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(NOTICE_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)


UPLOAD_ATTENDANCE = "static/uploads/attendance"
UPLOAD_ASSIGNMENTS = "static/uploads/assignments"

os.makedirs(UPLOAD_ATTENDANCE, exist_ok=True)
os.makedirs(UPLOAD_ASSIGNMENTS, exist_ok=True)


# ------------------ Helper Functions ------------------
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in {'png', 'jpg', 'jpeg', 'gif', 'pdf'}

def ensure_data_file():
    default_data = {
        "students": [],
        "attendanceData": [],
        "lastPIN": "",
        "lastSemester": ""
    }
    if not os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'w') as f:
                json.dump(default_data, f, indent=2)
            print(f"Created new data file at {DATA_FILE}")
        except Exception as e:
            print(f"FATAL: Could not create data file: {str(e)}", file=sys.stderr)
            sys.exit(1)

def load_data():
    try:
        with open(DATA_FILE, 'r') as f:
            data = json.load(f)
        if not all(k in data for k in ['students', 'attendanceData', 'lastPIN', 'lastSemester']):
            raise ValueError("Invalid data structure")
        return data
    except Exception as e:
        print(f"Error loading data: {str(e)}", file=sys.stderr)
        ensure_data_file()
        return load_data()

def save_data(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)

# Initialize SQLite DB
def init_db():
    os.makedirs("database", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Faculty table
    c.execute('''
        CREATE TABLE IF NOT EXISTS faculty (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    ''')

    # Attendance table
    c.execute('''
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_name TEXT NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL
        )
    ''')

    # Complaints table
    c.execute('''
        CREATE TABLE IF NOT EXISTS complaints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pin TEXT,
            name TEXT,
            complaint TEXT,
            timestamp TEXT,
            viewed INTEGER DEFAULT 0
        )
    ''')

    conn.commit()
    conn.close()

# ------------------ Routes ------------------

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/student")
def student_portal():
    return render_template("student_portal.html")

@app.route("/login", methods=["GET","POST"])
def login():
    if request.method == "POST":
        username = request.form.get('username')
        passcode = request.form.get('password')
        if passcode == get_faculty_password():
            session['user'] = username
            return redirect(url_for('faculty_dashboard'))
        else:
            flash("Invalid passcode")
    return render_template("login.html")

@app.route("/faculty-dashboard")
def faculty_dashboard():
    if 'user' in session:
        return render_template("faculty_dashboard.html", username=session['user'])
    return redirect(url_for("login"))

@app.route("/upload-timetable", methods=["GET", "POST"])
def upload_timetable():
    if 'user' not in session:
        return redirect(url_for("login"))

    if request.method == "POST":
        year = request.form.get('year')
        if not year:
            flash("Please select an academic year")
            return redirect(request.url)
            
        if 'timetable' not in request.files:
            flash("No file selected")
            return redirect(request.url)
            
        file = request.files['timetable']
        if file.filename == '':
            flash("No file selected")
            return redirect(request.url)
            
        # Determine file extension
        file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        
        # Save file with year-specific naming
        if file_ext in ['pdf', 'png', 'jpg', 'jpeg', 'gif']:
            if file_ext == 'pdf':
                filename = f"timetable_{year}.pdf"
            else:
                filename = f"timetable_{year}.jpg"
                
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            flash(f"Timetable for {year.replace('_', ' ')} uploaded successfully")
            return redirect(url_for("upload_timetable"))
        else:
            flash("Invalid file type. Only PDF and image files are allowed.")

    # Check which timetables exist for display
    timetable_files = {}
    years = ['1st_year', '2nd_year', '3rd_year']
    
    for year in years:
        pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], f"timetable_{year}.pdf")
        img_path = os.path.join(app.config['UPLOAD_FOLDER'], f"timetable_{year}.jpg")
        
        if os.path.exists(pdf_path):
            timetable_files[year] = {'filename': f"timetable_{year}.pdf", 'file_type': 'pdf', 'exists': True}
        elif os.path.exists(img_path):
            timetable_files[year] = {'filename': f"timetable_{year}.jpg", 'file_type': 'image', 'exists': True}
        else:
            timetable_files[year] = {'exists': False}

    return render_template("upload_timetable.html", timetable_files=timetable_files)

@app.route("/student-timetable")
def view_student_timetable():
    year = request.args.get('year', '1st_year')  # Default to 1st year
    
    # Check for both PDF and image versions
    pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], f"timetable_{year}.pdf")
    img_path = os.path.join(app.config['UPLOAD_FOLDER'], f"timetable_{year}.jpg")
    deleted_by_path = os.path.join(app.config['UPLOAD_FOLDER'], f"deleted_by_{year}.txt")

    if os.path.exists(pdf_path):
        return render_template("student_timetable.html", 
                             time=int(time.time()), 
                             show_image=True,
                             filename=f"timetable_{year}.pdf",
                             file_type='pdf',
                             current_year=year)
    elif os.path.exists(img_path):
        return render_template("student_timetable.html", 
                             time=int(time.time()), 
                             show_image=True,
                             filename=f"timetable_{year}.jpg",
                             file_type='image',
                             current_year=year)
    else:
        deleted_by = None
        if os.path.exists(deleted_by_path):
            with open(deleted_by_path, "r") as f:
                deleted_by = f.read().strip()
        return render_template("student_timetable.html", 
                             show_image=False, 
                             deleted_by=deleted_by,
                             current_year=year)

   

@app.route("/admin", methods=["GET", "POST"])
def admin():
    if request.method == "POST":
        code = request.form['code']
        if code == "123":
            session['admin'] = True
            return redirect(url_for("admin_dashboard"))
        else:
            flash("Wrong admin passcode")
    return render_template("admin.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))

@app.route("/timetable")
def timetable():
    return render_template("timetable.html")

@app.route("/remove-timetable", methods=["POST"])
def remove_timetable():
    if 'user' not in session:
        return redirect(url_for("login"))

    year = request.form.get('year')
    if not year:
        flash("No year specified")
        return redirect(url_for("upload_timetable"))

    # Check for both PDF and image versions
    pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], f"timetable_{year}.pdf")
    img_path = os.path.join(app.config['UPLOAD_FOLDER'], f"timetable_{year}.jpg")
    deleted_by_path = os.path.join(app.config['UPLOAD_FOLDER'], f"deleted_by_{year}.txt")

    if os.path.exists(pdf_path):
        os.remove(pdf_path)
        with open(deleted_by_path, "w") as f:
            f.write(session['user'])
        flash(f"Timetable for {year.replace('_', ' ')} removed successfully")
    elif os.path.exists(img_path):
        os.remove(img_path)
        with open(deleted_by_path, "w") as f:
            f.write(session['user'])
        flash(f"Timetable for {year.replace('_', ' ')} removed successfully")
    else:
        flash(f"No timetable found for {year.replace('_', ' ')}")

    return redirect(url_for("upload_timetable"))
# ---------------- Faculty Upload Notice ----------------

@app.route("/upload-notice", methods=["GET", "POST"])
def upload_notice():
    if 'user' not in session:
        return redirect(url_for("login"))

    notice_folder = app.config['NOTICE_FOLDER']
    os.makedirs(notice_folder, exist_ok=True)

    if request.method == "POST":
        file = request.files.get("notice_pdf")
        if file and file.filename.endswith(".pdf"):
            filename = secure_filename(file.filename)
            file.save(os.path.join(notice_folder, filename))
            flash("Notice uploaded successfully.")
            return redirect(url_for("upload_notice"))
        else:
            flash("Only PDF files are allowed.")

    pdf_files = [f for f in os.listdir(notice_folder) if f.endswith(".pdf")]
    return render_template("upload_notice.html", pdf_files=pdf_files)

# ---------------- Student View Notices ----------------

@app.route("/student-view-notices")
def student_view_notices():
    notices_path = os.path.join("static", "notices")
    os.makedirs(notices_path, exist_ok=True)

    pdf_files = [f for f in os.listdir(notices_path) if f.endswith(".pdf")]

    deleted_by = None
    deleted_info_path = os.path.join(notices_path, "deleted_by.txt")
    if not pdf_files and os.path.exists(deleted_info_path):
        with open(deleted_info_path, "r") as f:
            deleted_by = f.read().strip()

    return render_template("student_view_notices.html", pdf_files=pdf_files, deleted_by=deleted_by)

# ---------------- View Single PDF (optional direct link) ----------------

@app.route("/notices/<filename>")
def get_notice(filename):
    return send_from_directory(app.config['NOTICE_FOLDER'], filename)

# ---------------- Letter Generator ----------------

@app.route("/generate-letter", methods=["GET", "POST"])
def generate_letter():
    if request.method == "POST":
        date = request.form["date"]
        holiday_start = request.form["holiday_start"]
        holiday_end = request.form["holiday_end"]
        purpose = request.form["purpose"]

        rendered = render_template(
            "letter.html",
            date=datetime.strptime(date, "%Y-%m-%d").strftime("%d-%m-%Y"),
            holiday_start=datetime.strptime(holiday_start, "%Y-%m-%d").strftime("%d-%m-%Y"),
            holiday_end=datetime.strptime(holiday_end, "%Y-%m-%d").strftime("%d-%m-%Y"),
            purpose=purpose
        )

        output_path = os.path.join(OUTPUT_FOLDER, "generated_letter.pdf")
        pdfkit.from_string(rendered, output_path, configuration=PDFKIT_CONFIG)

        return send_file(output_path, as_attachment=True)

    return render_template("form.html")

@app.route("/generate-multiple-letter", methods=["GET", "POST"])
def generate_multiple_letter():
    if request.method == "POST":
        date = request.form["date"]
        holiday_start = request.form["holiday_start"]
        holiday_end = request.form["holiday_end"]
        reopen_date = request.form["reopen_date"]
        purpose = request.form["purpose"]

        rendered = render_template(
            "multiple_letter.html",
            date=datetime.strptime(date, "%Y-%m-%d").strftime("%d-%m-%Y"),
            holiday_start=datetime.strptime(holiday_start, "%Y-%m-%d").strftime("%d-%m-%Y"),
            holiday_end=datetime.strptime(holiday_end, "%Y-%m-%d").strftime("%d-%m-%Y"),
            reopen_date=datetime.strptime(reopen_date, "%Y-%m-%d").strftime("%d-%m-%Y"),
            purpose=purpose
        )

        output_path = os.path.join(OUTPUT_FOLDER, "generated_multiple_letter.pdf")
        pdfkit.from_string(rendered, output_path, configuration=PDFKIT_CONFIG)

        return send_file(output_path, as_attachment=True)

    return render_template("multiple_form.html")

@app.route("/generate-select")
def generate_select():
    return render_template("generate_select.html")

@app.route("/delete-notice/<filename>", methods=["POST"])
def delete_notice(filename):
    if 'user' not in session:
        return redirect(url_for("login"))

    filepath = os.path.join(app.config['NOTICE_FOLDER'], filename)
    notice_folder = app.config['NOTICE_FOLDER']
    deleted_by_path = os.path.join(notice_folder, "deleted_by.txt")

    if os.path.exists(filepath):
        os.remove(filepath)
        flash(f"{filename} deleted successfully.")

        # Check if all PDFs are now deleted
        remaining_pdfs = [f for f in os.listdir(notice_folder) if f.endswith(".pdf")]
        if not remaining_pdfs:
            with open(deleted_by_path, "w") as f:
                f.write(session['user'])  # save who deleted the last notice
    else:
        flash("File not found or already deleted.")

    return redirect(url_for("upload_notice"))

# --- Complaint Feature ---

@app.route('/submit_complaint', methods=['POST'])
def submit_complaint():
    pin = request.form['pin']
    name = request.form['name']
    complaint = request.form['complaint']
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO complaints (pin, name, complaint, timestamp, viewed)
            VALUES (?, ?, ?, ?, 0)
        ''', (pin, name, complaint, timestamp))
        conn.commit()
    flash("Complaint submitted successfully!")
    return redirect(url_for('student_portal'))

@app.route('/view_complaints')
def view_complaints():
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM complaints ORDER BY timestamp DESC")
        complaints = cursor.fetchall()
        cursor.execute("UPDATE complaints SET viewed = 1 WHERE viewed = 0")
        conn.commit()
    return render_template('view_complaints.html', complaints=complaints)
@app.route('/delete_complaint/<int:complaint_id>', methods=['DELETE'])
def delete_complaint(complaint_id):
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
        
    try:
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM complaints WHERE id = ?", (complaint_id,))
            conn.commit()
            
            if cursor.rowcount > 0:
                return jsonify({'message': 'Complaint deleted successfully'}), 200
            else:
                return jsonify({'error': 'Complaint not found'}), 404
                
    except Exception as e:
        return jsonify({'error': f'Database error: {str(e)}'}), 500

@app.route('/get_unread_complaint_count')
def get_unread_complaint_count():
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM complaints WHERE viewed = 0")
        count = cursor.fetchone()[0]
    return {'count': count}

@app.route('/upload_complaint')
def upload_complaint():
    return render_template('upload_complaint.html')

# ------------------ Attendance System Routes ------------------

@app.route('/launch-assignment')
def launch_assignment():
    try:
        # Launch the assignment/server.py in a subprocess
        subprocess.Popen(["python", "./assignment/app.py"])
        time.sleep(2)  # wait for server to start
        webbrowser.open("http://localhost:5001/")  # assuming server runs there
        return "Assignment app is starting..."
    except Exception as e:
        return f"Error launching assignment: {str(e)}"
    # ------------------- New Upload Routes -------------------

UPLOAD_ATTENDANCE = "static/uploads/attendance"
UPLOAD_ASSIGNMENT = "static/uploads/assignments"
os.makedirs(UPLOAD_ATTENDANCE, exist_ok=True)
os.makedirs(UPLOAD_ASSIGNMENT, exist_ok=True)

def get_year_folder(base_folder, year):
    folder = os.path.join(base_folder, f"year_{year}")
    os.makedirs(folder, exist_ok=True)
    return folder

@app.route("/upload-attendance-unique", methods=["GET", "POST"])
def upload_attendance_unique():
    if 'user' not in session:
        return redirect(url_for("login"))

    year = request.args.get("year")
    if request.method == "POST":
        year = request.form.get("year")
        files = request.files.getlist("pdfs")
        folder = get_year_folder(UPLOAD_ATTENDANCE, year)
        for file in files:
            if file.filename.endswith(".pdf"):
                file.save(os.path.join(folder, secure_filename(file.filename)))
        return redirect(url_for("upload_attendance_unique", year=year))

    pdf_files = []
    if year:
        folder = get_year_folder(UPLOAD_ATTENDANCE, year)
        pdf_files = os.listdir(folder)
    return render_template("upload_generic.html", year=year, pdf_files=pdf_files,
                           action_url=url_for("upload_attendance_unique"),
                           title="Upload Attendance")

@app.route("/upload-assignment-unique", methods=["GET", "POST"])
def upload_assignment_unique():
    if 'user' not in session:
        return redirect(url_for("login"))

    year = request.args.get("year")
    if request.method == "POST":
        year = request.form.get("year")
        files = request.files.getlist("pdfs")
        folder = get_year_folder(UPLOAD_ASSIGNMENTS, year)  # ✅ now using UPLOAD_ASSIGNMENTS
        for file in files:
            if file.filename.endswith(".pdf"):
                file.save(os.path.join(folder, secure_filename(file.filename)))
        return redirect(url_for("upload_assignment_unique", year=year))

    pdf_files = []
    if year:
        folder = get_year_folder(UPLOAD_ASSIGNMENTS, year)
        pdf_files = os.listdir(folder)
    return render_template("upload_generic.html", year=year, pdf_files=pdf_files,
                           action_url=url_for("upload_assignment_unique"),
                           title="Upload Assignment")


# ------------------ Delete PDFs ------------------
@app.route("/delete-upload/<file_type>/<year>/<filename>", methods=["POST"])
def delete_upload_unique(file_type, year, filename):
    if 'user' not in session:
        return redirect(url_for("login"))

    base_folder = UPLOAD_ATTENDANCE if file_type.startswith("attendance") else UPLOAD_ASSIGNMENTS
    folder = get_year_folder(base_folder, year)
    filepath = os.path.join(folder, filename)
    deleted_info = os.path.join(folder, "deleted_by.txt")

    if os.path.exists(filepath):
        os.remove(filepath)
        with open(deleted_info, "w") as f:
            f.write(session['user'])
    return redirect(request.referrer or url_for("faculty_dashboard"))

@app.route("/view-attendance-unique")
def view_attendance_unique():
    year = request.args.get("year", "1")  # Default to 1st year
    
    # Get files for all years
    pdf_files = {}
    for year_num in ['1', '2', '3']:
        folder = get_year_folder(UPLOAD_ATTENDANCE, year_num)
        pdf_files[year_num] = [f for f in os.listdir(folder) if f.endswith(".pdf")]
    
    return render_template("view_generic.html", 
                         title="View Attendance", 
                         year=year,
                         pdf_files=pdf_files, 
                         file_type="attendance")

@app.route("/view-assignment-unique")
def view_assignment_unique():
    year = request.args.get("year", "1")  # Default to 1st year
    
    # Get files for all years
    pdf_files = {}
    for year_num in ['1', '2', '3']:
        folder = get_year_folder(UPLOAD_ASSIGNMENTS, year_num)
        pdf_files[year_num] = [f for f in os.listdir(folder) if f.endswith(".pdf")]
    
    return render_template("view_generic.html", 
                         title="View Assignment", 
                         year=year,
                         pdf_files=pdf_files, 
                         file_type="assignments")# ------------------ Student View ------------------
@app.route("/home-page")
def home_page_unique():
    return render_template("index.html")
from flask import render_template, request, redirect, url_for, flash, session

def set_faculty_password(new_password):
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump({"faculty_password": new_password}, f)
        return True
    except Exception as e:
        print(f"Error saving password: {str(e)}")
        return False

# This route should be defined at the module level, not inside set_faculty_password
@app.route("/set_password", methods=["GET", "POST"])
def set_password():
    if not session.get('admin'):
        flash("Admin access required!")
        return redirect(url_for('admin'))

    if request.method == "POST":
        new_password = request.form.get('new_password')
        confirm_password = request.form.get('confirm_password')

        if new_password and new_password.strip() and new_password == confirm_password:
            success = set_faculty_password(new_password)
            if success:
                flash("Password updated successfully!")
                return redirect(url_for('admin_dashboard'))
            else:
                flash("Failed to update password. Please try again.")
        else:
            flash("Passwords do not match or empty!")

    return render_template("set_password.html")
@app.route("/admin_dashboard")
def admin_dashboard():
    if not session.get('admin'):
        flash("Admin access required!")
        return redirect(url_for('admin'))
    return render_template("admin_dashboard.html")

@app.route('/whatsapp', methods=['GET', 'POST'])
def whatsapp():
    if request.method == 'POST':
        number = request.form.get('phone_number', '').strip()
        if number:
            # Clean number (remove non-digits)
            number = ''.join(filter(str.isdigit, number))
            return redirect(f'https://wa.me/{number}')
    return render_template('whatsapp.html')
# Add this route to app.py - Place it with the other faculty routes
@app.route("/faculty-dashboard-return")
def faculty_dashboard_return():
    """Unique route to return to faculty dashboard from upload pages"""
    if 'user' in session:
        return redirect(url_for('faculty_dashboard'))
    return redirect(url_for("login"))

# Also add this route for direct access
@app.route("/back-to-dashboard")
def back_to_dashboard():
    """Alternative back to dashboard route"""
    if 'user' in session:
        return redirect(url_for('faculty_dashboard'))
    return redirect(url_for("login"))

if __name__ == "__main__":
    init_db()
    ensure_data_file()
    app.run(debug=True, host='0.0.0.0',port=5000)