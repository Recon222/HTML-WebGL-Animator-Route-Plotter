// utils.js
// Common utility functions to avoid circular dependencies

// Notification System
export function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span class="notification-icon material-icons">
            ${type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info'}
        </span>
        <span class="notification-message">${message}</span>
    `;
    
    const container = document.getElementById('notificationsContainer') || 
                     createNotificationsContainer();
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 500);
    }, 3000);
}

// Export createNotificationsContainer so it can be used in app-state.js
export function createNotificationsContainer() {
    if (!document.getElementById('notificationsContainer')) {
        const container = document.createElement('div');
        container.className = 'notifications-container';
        container.id = 'notificationsContainer';
        document.body.appendChild(container);
    }
    return document.getElementById('notificationsContainer');
}

// Time and Formatting Utilities
export function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function formatDateForInput(date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

export function formatTimeForInput(date) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
}

export function formatDateTime(date) {
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

// Unique ID Generation
export function generateUniqueId() {
    return 'id-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
} 