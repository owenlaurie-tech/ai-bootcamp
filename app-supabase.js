// ============================================
// Apple-Style To-Do App - Supabase Implementation
// ============================================

// ============================================
// Authentication Manager
// ============================================
class AuthManager {
    constructor() {
        this.currentUser = null;
        this.supabase = null;
    }

    async initialize() {
        this.supabase = initializeSupabase();
        if (!this.supabase) {
            throw new Error('Failed to initialize Supabase');
        }

        // Check for existing session
        const { data: { session } } = await this.supabase.auth.getSession();
        if (session) {
            this.currentUser = session.user;
            this.showApp();
        } else {
            this.showAuth();
        }

        // Listen for auth changes
        this.supabase.auth.onAuthStateChange((event, session) => {
            if (session) {
                this.currentUser = session.user;
                this.showApp();
                if (window.taskManager) {
                    window.taskManager.loadTasks();
                }
            } else {
                this.currentUser = null;
                this.showAuth();
            }
        });
    }

    showApp() {
        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('appContainer').style.display = 'block';
        document.getElementById('userEmail').textContent = this.currentUser?.email || '';
    }

    showAuth() {
        document.getElementById('authContainer').style.display = 'flex';
        document.getElementById('appContainer').style.display = 'none';
    }

    async signUp(email, password, username) {
        try {
            const { data, error } = await this.supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        username: username
                    }
                }
            });

            if (error) throw error;

            alert('Sign up successful! Please check your email to verify your account.');
            return data;
        } catch (error) {
            console.error('Sign up error:', error);
            throw error;
        }
    }

    async signIn(email, password) {
        try {
            const { data, error } = await this.supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Sign in error:', error);
            throw error;
        }
    }

    async signOut() {
        try {
            const { error } = await this.supabase.auth.signOut();
            if (error) throw error;
        } catch (error) {
            console.error('Sign out error:', error);
            throw error;
        }
    }

    getCurrentUser() {
        return this.currentUser;
    }
}

// ============================================
// Task Manager Class with Supabase
// ============================================
class TaskManager {
    constructor(authManager) {
        this.authManager = authManager;
        this.supabase = authManager.supabase;
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
        this.realtimeSubscription = null;
    }

    async initialize() {
        this.initializeEventListeners();
        this.initializeTheme();
        this.initializeKeyboardShortcuts();
        await this.loadTasks();
        this.setupRealtimeSubscription();
        this.renderTasks();
        this.updateTaskCount();
    }

    // ============================================
    // Real-time Subscription
    // ============================================
    setupRealtimeSubscription() {
        const userId = this.authManager.getCurrentUser()?.id;
        if (!userId) return;

        // Subscribe to changes in tasks table
        this.realtimeSubscription = this.supabase
            .channel('tasks-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'tasks',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => {
                    console.log('Real-time update:', payload);
                    this.handleRealtimeUpdate(payload);
                }
            )
            .subscribe();
    }

    handleRealtimeUpdate(payload) {
        const { eventType, new: newRecord, old: oldRecord } = payload;

        switch (eventType) {
            case 'INSERT':
                // Check if task already exists (avoid duplicates)
                if (!this.tasks.find(t => t.id === newRecord.id)) {
                    this.tasks.push(this.mapSupabaseTaskToLocal(newRecord));
                    this.renderTasks();
                    this.updateTaskCount();
                }
                break;
            case 'UPDATE':
                const updateIndex = this.tasks.findIndex(t => t.id === newRecord.id);
                if (updateIndex !== -1) {
                    this.tasks[updateIndex] = this.mapSupabaseTaskToLocal(newRecord);
                    this.renderTasks();
                    this.updateTaskCount();
                }
                break;
            case 'DELETE':
                this.tasks = this.tasks.filter(t => t.id !== oldRecord.id);
                this.renderTasks();
                this.updateTaskCount();
                break;
        }
    }

    // ============================================
    // Data Model & Storage
    // ============================================
    async createTask(data) {
        const userId = this.authManager.getCurrentUser()?.id;
        if (!userId) {
            alert('You must be logged in to create tasks');
            return;
        }

        try {
            // Insert task
            const { data: task, error: taskError } = await this.supabase
                .from('tasks')
                .insert([{
                    user_id: userId,
                    text: data.text,
                    completed: false,
                    due_date: data.dueDate || null,
                    due_time: data.dueTime || null,
                    priority: data.priority || 'none',
                    category: data.category || null,
                    parent_id: data.parentId || null,
                    order: this.tasks.length
                }])
                .select()
                .single();

            if (taskError) throw taskError;

            // Insert tags if present
            if (data.tags && data.tags.length > 0) {
                const tagInserts = data.tags.map(tag => ({
                    task_id: task.id,
                    tag_name: tag
                }));

                const { error: tagsError } = await this.supabase
                    .from('task_tags')
                    .insert(tagInserts);

                if (tagsError) console.error('Error inserting tags:', tagsError);
            }

            // Insert recurring pattern if enabled
            if (data.recurring && data.recurring.enabled) {
                const { error: recurringError } = await this.supabase
                    .from('recurring_patterns')
                    .insert([{
                        task_id: task.id,
                        enabled: true,
                        pattern: data.recurring.pattern,
                        interval: data.recurring.interval || 1
                    }]);

                if (recurringError) console.error('Error inserting recurring pattern:', recurringError);
            }

            // Fetch complete task with tags
            await this.loadTasks();
            return task;
        } catch (error) {
            console.error('Error creating task:', error);
            alert('Failed to create task: ' + error.message);
        }
    }

    async loadTasks() {
        const userId = this.authManager.getCurrentUser()?.id;
        if (!userId) {
            this.tasks = [];
            return;
        }

        try {
            // Fetch tasks with tags
            const { data: tasks, error: tasksError } = await this.supabase
                .from('tasks')
                .select(`
                    *,
                    task_tags (tag_name),
                    recurring_patterns (*)
                `)
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (tasksError) throw tasksError;

            // Map Supabase tasks to local format
            this.tasks = tasks.map(task => this.mapSupabaseTaskToLocal(task));

        } catch (error) {
            console.error('Error loading tasks:', error);
            this.tasks = [];
        }
    }

    mapSupabaseTaskToLocal(supabaseTask) {
        return {
            id: supabaseTask.id,
            text: supabaseTask.text,
            completed: supabaseTask.completed,
            createdAt: new Date(supabaseTask.created_at).getTime(),
            completedAt: supabaseTask.completed_at ? new Date(supabaseTask.completed_at).getTime() : null,
            dueDate: supabaseTask.due_date,
            dueTime: supabaseTask.due_time,
            priority: supabaseTask.priority,
            category: supabaseTask.category,
            tags: supabaseTask.task_tags ? supabaseTask.task_tags.map(t => t.tag_name) : [],
            recurring: supabaseTask.recurring_patterns?.[0] ? {
                enabled: supabaseTask.recurring_patterns[0].enabled,
                pattern: supabaseTask.recurring_patterns[0].pattern,
                interval: supabaseTask.recurring_patterns[0].interval
            } : { enabled: false, pattern: 'daily', interval: 1 },
            parentId: supabaseTask.parent_id,
            subtaskIds: [], // Will be populated if needed
            order: supabaseTask.order
        };
    }

    getTask(id) {
        return this.tasks.find(t => t.id === id);
    }

    async deleteTask(id) {
        const task = this.getTask(id);
        if (!task) return;

        try {
            const { error } = await this.supabase
                .from('tasks')
                .delete()
                .eq('id', id);

            if (error) throw error;

            // Local cleanup
            this.tasks = this.tasks.filter(t => t.id !== id);
            this.selectedTasks.delete(id);
            this.renderTasks();
            this.updateTaskCount();
            this.updateBulkToolbar();
        } catch (error) {
            console.error('Error deleting task:', error);
            alert('Failed to delete task: ' + error.message);
        }
    }

    async toggleTask(id) {
        const task = this.getTask(id);
        if (!task) return;

        const newCompletedStatus = !task.completed;

        try {
            const { error } = await this.supabase
                .from('tasks')
                .update({
                    completed: newCompletedStatus,
                    completed_at: newCompletedStatus ? new Date().toISOString() : null
                })
                .eq('id', id);

            if (error) throw error;

            // Update local state
            task.completed = newCompletedStatus;
            task.completedAt = newCompletedStatus ? Date.now() : null;

            // Handle recurring tasks
            if (newCompletedStatus && task.recurring.enabled) {
                await this.generateNextRecurrence(task);
            }

            this.renderTasks();
            this.updateTaskCount();
        } catch (error) {
            console.error('Error toggling task:', error);
            alert('Failed to update task: ' + error.message);
        }
    }

    async updateTask(id, updates) {
        const task = this.getTask(id);
        if (!task) return;

        try {
            // Map local field names to Supabase column names
            const supabaseUpdates = {};
            if (updates.text !== undefined) supabaseUpdates.text = updates.text;
            if (updates.dueDate !== undefined) supabaseUpdates.due_date = updates.dueDate;
            if (updates.dueTime !== undefined) supabaseUpdates.due_time = updates.dueTime;
            if (updates.priority !== undefined) supabaseUpdates.priority = updates.priority;
            if (updates.category !== undefined) supabaseUpdates.category = updates.category;

            const { error } = await this.supabase
                .from('tasks')
                .update(supabaseUpdates)
                .eq('id', id);

            if (error) throw error;

            // Update local state
            Object.assign(task, updates);
            this.renderTasks();
        } catch (error) {
            console.error('Error updating task:', error);
            alert('Failed to update task: ' + error.message);
        }
    }

    // ============================================
    // Recurring Tasks
    // ============================================
    async generateNextRecurrence(task) {
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

        await this.createTask({
            text: task.text,
            dueDate: nextDate.toISOString().split('T')[0],
            dueTime: task.dueTime,
            priority: task.priority,
            category: task.category,
            tags: task.tags,
            recurring: pattern
        });
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
            recurringHTML = `<span class="task-category">🔄 ${task.recurring.pattern}</span>`;
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
        document.getElementById('clearCompleted').addEventListener('click', async () => {
            const completedTasks = this.tasks.filter(t => t.completed);
            if (completedTasks.length === 0) return;

            if (!confirm(`Delete ${completedTasks.length} completed task(s)?`)) return;

            for (const task of completedTasks) {
                await this.deleteTask(task.id);
            }
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
        document.getElementById('bulkComplete').addEventListener('click', async () => {
            for (const id of this.selectedTasks) {
                const task = this.getTask(id);
                if (task && !task.completed) {
                    await this.toggleTask(id);
                }
            }
            this.clearSelection();
        });

        document.getElementById('bulkDelete').addEventListener('click', async () => {
            if (!confirm(`Delete ${this.selectedTasks.size} task(s)?`)) return;
            for (const id of this.selectedTasks) {
                await this.deleteTask(id);
            }
            this.clearSelection();
        });

        document.getElementById('bulkClear').addEventListener('click', () => {
            this.clearSelection();
        });

        // Theme toggle
        document.getElementById('themeToggle').addEventListener('click', () => {
            this.toggleTheme();
        });

        // Sign out button
        document.getElementById('signOutBtn').addEventListener('click', async () => {
            if (confirm('Are you sure you want to sign out?')) {
                await this.authManager.signOut();
            }
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

    async addTask() {
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

        await this.createTask(taskData);

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

    async saveTaskEdit() {
        if (!this.currentEditingId) return;

        const text = document.getElementById('editTaskText').value.trim();
        if (!text) {
            alert('Task description cannot be empty!');
            return;
        }

        const selectedPriority = document.querySelector('#editPriorityButtons .priority-btn.selected');

        await this.updateTask(this.currentEditingId, {
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

    // ============================================
    // Cleanup
    // ============================================
    destroy() {
        if (this.realtimeSubscription) {
            this.realtimeSubscription.unsubscribe();
        }
    }
}

// ============================================
// Initialize App
// ============================================
let authManager;
let taskManager;

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize auth
    authManager = new AuthManager();
    await authManager.initialize();

    // Initialize task manager if user is authenticated
    if (authManager.getCurrentUser()) {
        taskManager = new TaskManager(authManager);
        await taskManager.initialize();
        window.taskManager = taskManager; // Make it globally accessible for onclick handlers
    }

    // Setup auth form handlers
    setupAuthHandlers();
});

function setupAuthHandlers() {
    const showSignIn = document.getElementById('showSignIn');
    const showSignUp = document.getElementById('showSignUp');
    const signInForm = document.getElementById('signInForm');
    const signUpForm = document.getElementById('signUpForm');
    const signInSubmit = document.getElementById('signInSubmit');
    const signUpSubmit = document.getElementById('signUpSubmit');

    showSignIn.addEventListener('click', (e) => {
        e.preventDefault();
        signUpForm.style.display = 'none';
        signInForm.style.display = 'block';
    });

    showSignUp.addEventListener('click', (e) => {
        e.preventDefault();
        signInForm.style.display = 'none';
        signUpForm.style.display = 'block';
    });

    signInSubmit.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signInEmail').value;
        const password = document.getElementById('signInPassword').value;

        try {
            signInSubmit.disabled = true;
            signInSubmit.textContent = 'Signing in...';
            await authManager.signIn(email, password);
        } catch (error) {
            alert('Sign in failed: ' + error.message);
        } finally {
            signInSubmit.disabled = false;
            signInSubmit.textContent = 'Sign In';
        }
    });

    signUpSubmit.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signUpEmail').value;
        const password = document.getElementById('signUpPassword').value;
        const username = document.getElementById('signUpUsername').value;

        if (password.length < 6) {
            alert('Password must be at least 6 characters');
            return;
        }

        try {
            signUpSubmit.disabled = true;
            signUpSubmit.textContent = 'Signing up...';
            await authManager.signUp(email, password, username);
        } catch (error) {
            alert('Sign up failed: ' + error.message);
        } finally {
            signUpSubmit.disabled = false;
            signUpSubmit.textContent = 'Sign Up';
        }
    });
}
