document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const daysSelect = document.getElementById('days');
    const periodsSelect = document.getElementById('periods');
    const periodTimesContainer = document.getElementById('period-times-container');
    const subjectInput = document.getElementById('subject');
    const teacherInput = document.getElementById('teacher');
    const colorInput = document.getElementById('subject-color');
    const colorDisplay = document.getElementById('selected-color');
    const generateBtn = document.getElementById('generate-btn');
    const printBtn = document.getElementById('print-btn');
    const resetBtn = document.getElementById('reset-btn');
    const timetableContainer = document.getElementById('timetable-container');
    
    // Color picker event
    colorInput.addEventListener('input', function() {
        colorDisplay.textContent = this.value;
    });
    
    // When periods value changes, update period time inputs
    periodsSelect.addEventListener('change', updatePeriodTimeInputs);
    
    // Generate timetable
    generateBtn.addEventListener('click', generateTimetable);
    
    // Print timetable
    printBtn.addEventListener('click', function() {
        window.print();
    });
    
    // Reset timetable
    resetBtn.addEventListener('click', function() {
        timetableContainer.innerHTML = '';
        subjectInput.value = '';
        teacherInput.value = '';
        updatePeriodTimeInputs();
    });
    
    // Initialize period time inputs
    updatePeriodTimeInputs();
    
    function updatePeriodTimeInputs() {
        const periods = parseInt(periodsSelect.value);
        periodTimesContainer.innerHTML = '';
        
        for (let i = 1; i <= periods; i++) {
            const group = document.createElement('div');
            group.className = 'period-time-group';
            
            const label = document.createElement('label');
            label.textContent = `Period ${i}:`;
            group.appendChild(label);
            
            const startInput = document.createElement('input');
            startInput.type = 'time';
            startInput.id = `period-${i}-start`;
            startInput.value = i === 1 ? '08:00' : '';
            group.appendChild(startInput);
            
            const toSpan = document.createElement('span');
            toSpan.textContent = 'to';
            group.appendChild(toSpan);
            
            const endInput = document.createElement('input');
            endInput.type = 'time';
            endInput.id = `period-${i}-end`;
            endInput.value = i === 1 ? '08:45' : '';
            group.appendChild(endInput);
            
            periodTimesContainer.appendChild(group);
        }
    }
    
    function generateTimetable() {
        const days = parseInt(daysSelect.value);
        const periods = parseInt(periodsSelect.value);
        
        // Collect all period times
        const periodTimes = [];
        let validTimes = true;
        
        for (let i = 1; i <= periods; i++) {
            const startTime = document.getElementById(`period-${i}-start`).value;
            const endTime = document.getElementById(`period-${i}-end`).value;
            
            if (!startTime || !endTime) {
                alert(`Please enter both start and end times for Period ${i}`);
                validTimes = false;
                break;
            }
            
            periodTimes.push({
                period: i,
                start: startTime,
                end: endTime
            });
        }
        
        if (!validTimes) return;
        
        // Create timetable HTML
        let timetableHTML = '<table class="timetable"><thead><tr><th>Day/Time</th>';
        
        // Add period time headers
        periodTimes.forEach(time => {
            const startFormatted = formatTimeForDisplay(time.start);
            const endFormatted = formatTimeForDisplay(time.end);
            timetableHTML += `<th>${startFormatted} - ${endFormatted}</th>`;
        });
        timetableHTML += '</tr></thead><tbody>';
        
        // Add day rows
        const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        for (let d = 0; d < days; d++) {
            timetableHTML += `<tr><td class="day-header">${dayNames[d]}</td>`;
            
            for (let p = 0; p < periods; p++) {
                const cellId = `day-${d}-period-${p+1}`;
                timetableHTML += `<td id="${cellId}" class="empty-slot"></td>`;
            }
            
            timetableHTML += '</tr>';
        }
        
        timetableHTML += '</tbody></table>';
        timetableContainer.innerHTML = timetableHTML;
        
        // Add event listeners to all cells
        document.querySelectorAll('.empty-slot').forEach(cell => {
            cell.addEventListener('click', function() {
                const subject = subjectInput.value.trim();
                const teacher = teacherInput.value.trim();
                const color = colorInput.value;
                
                if (subject === '') {
                    alert('Please enter a subject name');
                    return;
                }
                
                const displayText = teacher ? `${subject}<br><small>${teacher}</small>` : subject;
                
                this.innerHTML = displayText;
                this.style.backgroundColor = color;
                this.style.color = getContrastColor(color);
                this.classList.remove('empty-slot');
                this.classList.add('subject');
                
                // Store additional data as data attributes
                this.dataset.subject = subject;
                this.dataset.teacher = teacher;
                this.dataset.color = color;
            });
        });
    }
    
    function formatTimeForDisplay(timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const period = hours >= 12 ? 'PM' : 'AM';
        const hours12 = hours % 12 || 12;
        return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
    }
    
    function getContrastColor(hexColor) {
        // Convert hex to RGB
        const r = parseInt(hexColor.substr(1, 2), 16);
        const g = parseInt(hexColor.substr(3, 2), 16);
        const b = parseInt(hexColor.substr(5, 2), 16);
        
        // Calculate luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        
        // Return black or white depending on luminance
        return luminance > 0.5 ? '#000000' : '#ffffff';
    }
});