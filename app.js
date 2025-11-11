// ============================================
// Apple-Style To-Do App - Complete Implementation
// ============================================

// ============================================
// Task Manager Class
// ============================================
class TaskManager {
    constructor() {
        this.tasks = [];
        this.selectedTasks = new Set();
        this.currentFilter = {
            status: 'all',
            date: null,
            priority: [],
            category: null,
            search: ''
        };
        this.currentPriority = 'none';
        this.currentEditingId = null;

        this.loadTasks();
        this.initializeEventListeners();
        this.initializeTheme();
        this.initializeKeyboardShortcuts();
        this.renderTasks();
        this.updateTaskCount();
    }

    // ============================================
    // Data Model & Storage
    // ============================================
    createTask(data) {
        const task = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            text: data.text,
            completed: false,
            createdAt: Date.now(),
            completedAt: null,
            dueDate: data.dueDate || null,
            dueTime: data.dueTime || null,
            recurring: data.recurring || {
                enabled: false,
                pattern: 'daily',
                interval: 1
            },
            category: data.category || null,
            tags: data.tags || [],
            priority: data.priority || 'none',
            parentId: data.parentId || null,
            subtaskIds: [],
            order: this.tasks.length
        };

        this.tasks.push(task);
        this.saveTasks();
        return task;
    }

    loadTasks() {
        try {
            const data = localStorage.getItem('tasks_v2');
            if (data) {
                this.tasks = JSON.parse(data);
            }
        } catch (e) {
            console.error('Error loading tasks:', e);
            this.tasks = [];
        }
    }

    saveTasks() {
        try {
            localStorage.setItem('tasks_v2', JSON.stringify(this.tasks));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                alert('Storage limit reached. Please clear some completed tasks.');
            }
            console.error('Error saving tasks:', e);
        }
    }

    getTask(id) {
        return this.tasks.find(t => t.id === id);
    }

    deleteTask(id) {
        const task = this.getTask(id);
        if (!task) return;

        // Remove from parent's subtask list
        if (task.parentId) {
            const parent = this.getTask(task.parentId);
            if (parent) {
                parent.subtaskIds = parent.subtaskIds.filter(sid => sid !== id);
            }
        }

        // Delete all subtasks
        if (task.subtaskIds && task.subtaskIds.length > 0) {
            task.subtaskIds.forEach(subId => this.deleteTask(subId));
        }

        this.tasks = this.tasks.filter(t => t.id !== id);
        this.selectedTasks.delete(id);
        this.saveTasks();
        this.renderTasks();
        this.updateTaskCount();
        this.updateBulkToolbar();
    }

    toggleTask(id) {
        const task = this.getTask(id);
        if (!task) return;

        task.completed = !task.completed;
        task.completedAt = task.completed ? Date.now() : null;

        // Handle recurring tasks
        if (task.completed && task.recurring.enabled) {
            this.generateNextRecurrence(task);
        }

        this.saveTasks();
        this.renderTasks();
        this.updateTaskCount();
    }

    updateTask(id, updates) {
        const task = this.getTask(id);
        if (!task) return;

        Object.assign(task, updates);
        this.saveTasks();
        this.renderTasks();
    }

    // ============================================
    // Recurring Tasks
    // ============================================
    generateNextRecurrence(task) {
        const pattern = task.recurring;
        if (!pattern.enabled) return;

        let nextDate = new Date(task.dueDate || Date.now());

        switch (pattern.pattern) {
            case 'daily':
                nextDate.setDate(nextDate.getDate() + (pattern.interval || 1));
                break;
            case 'weekly':
                nextDate.setDate(nextDate.getDate() + (7 * (pattern.interval || 1)));
                break;
            case 'monthly':
                nextDate.setMonth(nextDate.getMonth() + (pattern.interval || 1));
                break;
        }

        const newTask = {
            ...task,
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            completed: false,
            completedAt: null,
            createdAt: Date.now(),
            dueDate: nextDate.toISOString().split('T')[0]
        };

        this.tasks.push(newTask);
        this.saveTasks();
    }

    // ============================================
    // Filtering & Sorting
    // ============================================
    filterTasks() {
        let filtered = [...this.tasks];

        // Status filter
        if (this.currentFilter.status === 'active') {
            filtered = filtered.filter(t => !t.completed);
        } else if (this.currentFilter.status === 'completed') {
            filtered = filtered.filter(t => t.completed);
        }

        // Date filter
        if (this.currentFilter.date) {
            const today = new Date().toISOString().split('T')[0];
            switch (this.currentFilter.date) {
                case 'overdue':
                    filtered = filtered.filter(t =>
                        t.dueDate && t.dueDate < today && !t.completed
                    );
                    break;
                case 'today':
                    filtered = filtered.filter(t => t.dueDate === today);
                    break;
                case 'week':
                    const weekEnd = new Date();
                    weekEnd.setDate(weekEnd.getDate() + 7);
                    filtered = filtered.filter(t =>
                        t.dueDate &&
                        t.dueDate >= today &&
                        t.dueDate <= weekEnd.toISOString().split('T')[0]
                    );
                    break;
            }
        }

        // Priority filter
        if (this.currentFilter.priority.length > 0) {
            filtered = filtered.filter(t =>
                this.currentFilter.priority.includes(t.priority)
            );
        }

        // Category filter
        if (this.currentFilter.category) {
            filtered = filtered.filter(t =>
                t.category === this.currentFilter.category
            );
        }

        // Search filter
        if (this.currentFilter.search) {
            const search = this.currentFilter.search.toLowerCase();
            filtered = filtered.filter(t =>
                t.text.toLowerCase().includes(search)
            );
        }

        return filtered;
    }

    sortTasks(tasks) {
        return tasks.sort((a, b) => {
            // Priority first
            const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
            if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            }

            // Then by due date
            if (a.dueDate && b.dueDate) {
                return new Date(a.dueDate) - new Date(b.dueDate);
            }
            if (a.dueDate) return -1;
            if (b.dueDate) return 1;

            // Then by creation date
            return b.createdAt - a.createdAt;
        });
    }

    // ============================================
    // Rendering
    // ============================================
    renderTasks() {
        const taskList = document.getElementById('taskList');
        const emptyState = document.getElementById('emptyState');

        let filtered = this.filterTasks();
        filtered = this.sortTasks(filtered);

        // Show empty state if no tasks
        if (filtered.length === 0) {
            taskList.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        taskList.innerHTML = '';

        filtered.forEach(task => {
            const li = this.createTaskElement(task);
            taskList.appendChild(li);
        });
    }

    createTaskElement(task) {
        const li = document.createElement('li');
        li.className = `task-item ${task.completed ? 'completed' : ''}`;
        li.dataset.taskId = task.id;

        // Priority indicator
        const priorityClass = `priority-${task.priority}`;

        // Format due date
        let dueDateHTML = '';
        if (task.dueDate) {
            const isOverdue = !task.completed && task.dueDate < new Date().toISOString().split('T')[0];
            const overdueClass = isOverdue ? 'overdue' : '';
            dueDateHTML = `<span class="task-due-date ${overdueClass}">📅 ${this.formatDate(task.dueDate)}</span>`;
        }

        // Category
        let categoryHTML = '';
        if (task.category) {
            const categoryEmojis = {
                work: '💼',
                personal: '👤',
                shopping: '🛒',
                health: '❤️',
                finance: '💰',
                home: '🏠'
            };
            categoryHTML = `<span class="task-category">${categoryEmojis[task.category] || '🏷️'} ${task.category}</span>`;
        }

        // Tags
        let tagsHTML = '';
        if (task.tags && task.tags.length > 0) {
            tagsHTML = `<div class="task-tags">${task.tags.map(tag =>
                `<span class="tag-chip">${tag}</span>`
            ).join('')}</div>`;
        }

        // Recurring indicator
        let recurringHTML = '';
        if (task.recurring && task.recurring.enabled) {
            recurringHTML = '<span class="task-category">🔄 ${task.recurring.pattern}</span>';
        }

        li.innerHTML = `
            ${this.selectedTasks.size > 0 ? `<input type="checkbox" class="task-select" ${this.selectedTasks.has(task.id) ? 'checked' : ''} />` : ''}
            <span class="priority-indicator ${priorityClass}"></span>
            <input type="checkbox" ${task.completed ? 'checked' : ''} onchange="taskManager.toggleTask('${task.id}')" />
            <div class="task-content">
                <span class="task-text">${this.escapeHtml(task.text)}</span>
                ${(dueDateHTML || categoryHTML || tagsHTML || recurringHTML) ? `
                    <div class="task-meta">
                        ${dueDateHTML}
                        ${categoryHTML}
                        ${recurringHTML}
                        ${tagsHTML}
                    </div>
                ` : ''}
            </div>
            <div class="task-actions">
                <button class="task-btn" onclick="taskManager.openEditModal('${task.id}')" aria-label="Edit task">✏️</button>
                <button class="delete-btn" onclick="taskManager.deleteTask('${task.id}')">Delete</button>
            </div>
        `;

        // Add event listener for selection checkbox
        const selectCheckbox = li.querySelector('.task-select');
        if (selectCheckbox) {
            selectCheckbox.addEventListener('change', (e) => {
                e.stopPropagation();
                if (e.target.checked) {
                    this.selectedTasks.add(task.id);
                } else {
                    this.selectedTasks.delete(task.id);
                }
                this.updateBulkToolbar();
            });
        }

        return li;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (dateString === today.toISOString().split('T')[0]) {
            return 'Today';
        } else if (dateString === tomorrow.toISOString().split('T')[0]) {
            return 'Tomorrow';
        } else {
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updateTaskCount() {
        const activeTasks = this.tasks.filter(t => !t.completed).length;
        const taskCount = document.getElementById('taskCount');
        taskCount.textContent = `${activeTasks} task${activeTasks !== 1 ? 's' : ''}`;
    }

    // ============================================
    // UI Event Handlers
    // ============================================
    initializeEventListeners() {
        // Add task button
        const addBtn = document.getElementById('addBtn');
        const taskInput = document.getElementById('taskInput');

        addBtn.addEventListener('click', () => this.addTask());
        taskInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTask();
        });

        // Clear completed
        document.getElementById('clearCompleted').addEventListener('click', () => {
            this.tasks = this.tasks.filter(t => !t.completed);
            this.saveTasks();
            this.renderTasks();
            this.updateTaskCount();
        });

        // Quick action buttons
        document.getElementById('dueDateBtn').addEventListener('click', () => {
            this.scrollToOption('dueDateInput');
        });

        document.getElementById('priorityBtn').addEventListener('click', () => {
            this.scrollToOption('priority');
        });

        document.getElementById('categoryBtn').addEventListener('click', () => {
            this.scrollToOption('categoryInput');
        });

        document.getElementById('moreOptionsBtn').addEventListener('click', () => {
            const options = document.getElementById('advancedOptions');
            options.classList.toggle('expanded');
        });

        // Priority buttons
        document.querySelectorAll('.priority-btn[data-priority]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.priority-btn[data-priority]').forEach(b =>
                    b.classList.remove('selected')
                );
                btn.classList.add('selected');
                this.currentPriority = btn.dataset.priority;
            });
        });

        // Recurring checkbox
        document.getElementById('recurringCheckbox').addEventListener('change', (e) => {
            document.getElementById('recurringOptions').style.display =
                e.target.checked ? 'block' : 'none';
        });

        // Filter toggle
        document.getElementById('filterToggle').addEventListener('click', () => {
            const options = document.getElementById('filterOptions');
            options.classList.toggle('show');
            document.getElementById('filterToggle').setAttribute('aria-expanded',
                options.classList.contains('show'));
        });

        // Filter buttons
        document.querySelectorAll('[data-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                const filterType = btn.dataset.filter;
                const value = btn.dataset.value;

                if (filterType === 'status') {
                    document.querySelectorAll('[data-filter="status"]').forEach(b =>
                        b.classList.remove('active')
                    );
                    btn.classList.add('active');
                    this.currentFilter.status = value;
                } else if (filterType === 'date') {
                    // Toggle date filter
                    if (btn.classList.contains('active')) {
                        btn.classList.remove('active');
                        this.currentFilter.date = null;
                    } else {
                        document.querySelectorAll('[data-filter="date"]').forEach(b =>
                            b.classList.remove('active')
                        );
                        btn.classList.add('active');
                        this.currentFilter.date = value;
                    }
                } else if (filterType === 'priority') {
                    // Toggle priority filter
                    btn.classList.toggle('selected');
                    if (btn.classList.contains('selected')) {
                        this.currentFilter.priority.push(value);
                    } else {
                        this.currentFilter.priority = this.currentFilter.priority.filter(p => p !== value);
                    }
                }

                this.updateFilterBadge();
                this.renderTasks();
            });
        });

        // Clear filters
        document.getElementById('clearFilters').addEventListener('click', () => {
            this.currentFilter = {
                status: 'all',
                date: null,
                priority: [],
                category: null,
                search: ''
            };

            // Reset UI
            document.querySelectorAll('[data-filter="status"]').forEach(b =>
                b.classList.remove('active')
            );
            document.querySelector('[data-filter="status"][data-value="all"]').classList.add('active');
            document.querySelectorAll('[data-filter="date"]').forEach(b =>
                b.classList.remove('active')
            );
            document.querySelectorAll('[data-filter="priority"]').forEach(b =>
                b.classList.remove('selected')
            );

            this.updateFilterBadge();
            this.renderTasks();
        });

        // Bulk operations
        document.getElementById('bulkComplete').addEventListener('click', () => {
            this.selectedTasks.forEach(id => {
                const task = this.getTask(id);
                if (task && !task.completed) {
                    this.toggleTask(id);
                }
            });
            this.clearSelection();
        });

        document.getElementById('bulkDelete').addEventListener('click', () => {
            if (!confirm(`Delete ${this.selectedTasks.size} task(s)?`)) return;
            this.selectedTasks.forEach(id => this.deleteTask(id));
            this.clearSelection();
        });

        document.getElementById('bulkClear').addEventListener('click', () => {
            this.clearSelection();
        });

        // Theme toggle
        document.getElementById('themeToggle').addEventListener('click', () => {
            this.toggleTheme();
        });

        // Modal close buttons
        document.getElementById('closeShortcuts').addEventListener('click', () => {
            document.getElementById('shortcutsModal').classList.remove('show');
        });

        document.getElementById('closeEditModal').addEventListener('click', () => {
            this.closeEditModal();
        });

        document.getElementById('cancelTaskEdit').addEventListener('click', () => {
            this.closeEditModal();
        });

        document.getElementById('saveTaskEdit').addEventListener('click', () => {
            this.saveTaskEdit();
        });

        // Edit modal priority buttons
        document.querySelectorAll('#editPriorityButtons .priority-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#editPriorityButtons .priority-btn').forEach(b =>
                    b.classList.remove('selected')
                );
                btn.classList.add('selected');
            });
        });

        // Click outside modal to close
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('show');
                }
            });
        });
    }

    addTask() {
        const taskInput = document.getElementById('taskInput');
        const text = taskInput.value.trim();

        if (!text) {
            alert('Please enter a task!');
            return;
        }

        const dueDateInput = document.getElementById('dueDateInput');
        const dueTimeInput = document.getElementById('dueTimeInput');
        const categoryInput = document.getElementById('categoryInput');
        const tagsInput = document.getElementById('tagsInput');
        const recurringCheckbox = document.getElementById('recurringCheckbox');
        const recurringPattern = document.getElementById('recurringPattern');

        const taskData = {
            text: text,
            dueDate: dueDateInput.value || null,
            dueTime: dueTimeInput.value || null,
            priority: this.currentPriority,
            category: categoryInput.value || null,
            tags: tagsInput.value ? tagsInput.value.split(',').map(t => t.trim()).filter(t => t) : [],
            recurring: recurringCheckbox.checked ? {
                enabled: true,
                pattern: recurringPattern.value,
                interval: 1
            } : { enabled: false }
        };

        this.createTask(taskData);

        // Reset form
        taskInput.value = '';
        dueDateInput.value = '';
        dueTimeInput.value = '';
        categoryInput.value = '';
        tagsInput.value = '';
        recurringCheckbox.checked = false;
        document.getElementById('recurringOptions').style.display = 'none';

        // Reset priority
        document.querySelectorAll('.priority-btn[data-priority]').forEach(b =>
            b.classList.remove('selected')
        );
        document.querySelector('.priority-btn[data-priority="none"]').classList.add('selected');
        this.currentPriority = 'none';

        // Collapse advanced options
        document.getElementById('advancedOptions').classList.remove('expanded');

        this.renderTasks();
        this.updateTaskCount();
    }

    scrollToOption(elementId) {
        const options = document.getElementById('advancedOptions');
        if (!options.classList.contains('expanded')) {
            options.classList.add('expanded');
        }
        setTimeout(() => {
            document.getElementById(elementId).focus();
        }, 300);
    }

    updateFilterBadge() {
        let count = 0;
        if (this.currentFilter.status !== 'all') count++;
        if (this.currentFilter.date) count++;
        count += this.currentFilter.priority.length;

        const badge = document.getElementById('filterBadge');
        if (count > 0) {
            badge.textContent = count;
            badge.hidden = false;
        } else {
            badge.hidden = true;
        }
    }

    // ============================================
    // Bulk Operations
    // ============================================
    clearSelection() {
        this.selectedTasks.clear();
        this.updateBulkToolbar();
        this.renderTasks();
    }

    updateBulkToolbar() {
        const toolbar = document.getElementById('bulkToolbar');
        const count = document.getElementById('selectionCount');

        if (this.selectedTasks.size > 0) {
            toolbar.classList.add('show');
            count.textContent = `${this.selectedTasks.size} selected`;
        } else {
            toolbar.classList.remove('show');
        }
    }

    // ============================================
    // Task Editing
    // ============================================
    openEditModal(taskId) {
        const task = this.getTask(taskId);
        if (!task) return;

        this.currentEditingId = taskId;

        document.getElementById('editTaskText').value = task.text;
        document.getElementById('editDueDate').value = task.dueDate || '';
        document.getElementById('editCategory').value = task.category || '';

        // Set priority
        document.querySelectorAll('#editPriorityButtons .priority-btn').forEach(btn => {
            btn.classList.remove('selected');
            if (btn.dataset.priority === task.priority) {
                btn.classList.add('selected');
            }
        });

        document.getElementById('taskEditModal').classList.add('show');
    }

    closeEditModal() {
        document.getElementById('taskEditModal').classList.remove('show');
        this.currentEditingId = null;
    }

    saveTaskEdit() {
        if (!this.currentEditingId) return;

        const text = document.getElementById('editTaskText').value.trim();
        if (!text) {
            alert('Task description cannot be empty!');
            return;
        }

        const selectedPriority = document.querySelector('#editPriorityButtons .priority-btn.selected');

        this.updateTask(this.currentEditingId, {
            text: text,
            dueDate: document.getElementById('editDueDate').value || null,
            category: document.getElementById('editCategory').value || null,
            priority: selectedPriority ? selectedPriority.dataset.priority : 'none'
        });

        this.closeEditModal();
    }

    // ============================================
    // Theme Management
    // ============================================
    initializeTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        this.updateThemeIcon(savedTheme);
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';

        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        this.updateThemeIcon(newTheme);
    }

    updateThemeIcon(theme) {
        const icon = document.getElementById('themeIcon');
        icon.textContent = theme === 'light' ? '☀️' : '🌙';
    }

    // ============================================
    // Keyboard Shortcuts
    // ============================================
    initializeKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in inputs
            if (e.target.matches('input, textarea, select')) {
                if (e.key === 'Escape') {
                    e.target.blur();
                }
                return;
            }

            switch (e.key.toLowerCase()) {
                case 'n':
                    document.getElementById('taskInput').focus();
                    break;
                case 'f':
                    document.getElementById('filterToggle').click();
                    break;
                case '/':
                    e.preventDefault();
                    document.getElementById('taskInput').focus();
                    break;
                case '?':
                    document.getElementById('shortcutsModal').classList.add('show');
                    break;
                case 't':
                    // Today's tasks
                    document.querySelector('[data-filter="date"][data-value="today"]').click();
                    break;
                case 'a':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        // Select all visible tasks
                        this.filterTasks().forEach(task => this.selectedTasks.add(task.id));
                        this.updateBulkToolbar();
                        this.renderTasks();
                    } else {
                        // All tasks filter
                        document.querySelector('[data-filter="status"][data-value="all"]').click();
                    }
                    break;
                case '1':
                    document.querySelector('[data-filter="priority"][data-value="urgent"]').click();
                    break;
                case '2':
                    document.querySelector('[data-filter="priority"][data-value="high"]').click();
                    break;
                case '3':
                    document.querySelector('[data-filter="priority"][data-value="medium"]').click();
                    break;
                case '4':
                    document.querySelector('[data-filter="priority"][data-value="low"]').click();
                    break;
                case 'escape':
                    this.clearSelection();
                    document.querySelectorAll('.modal.show').forEach(modal => {
                        modal.classList.remove('show');
                    });
                    break;
            }
        });

        // Shift+click for multi-select
        document.addEventListener('click', (e) => {
            const taskItem = e.target.closest('.task-item');
            if (taskItem && e.shiftKey) {
                const taskId = taskItem.dataset.taskId;
                if (this.selectedTasks.has(taskId)) {
                    this.selectedTasks.delete(taskId);
                } else {
                    this.selectedTasks.add(taskId);
                }
                this.updateBulkToolbar();
                this.renderTasks();
            }
        });
    }
}

// ============================================
// Initialize App
// ============================================
let taskManager;

document.addEventListener('DOMContentLoaded', () => {
    taskManager = new TaskManager();
});
