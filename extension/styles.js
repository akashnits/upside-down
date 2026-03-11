// styles.js — CSS-in-JS constants for the floating button
// Separated from main.js for cleaner separation of concerns

const BUTTON_STYLES = {
    base: `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        width: 60px;
        height: 60px;
        background: #0A66C2;
        color: white;
        border: none;
        border-radius: 50%;
        font-size: 28px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(10, 102, 194, 0.4);
        transition: transform 0.2s, box-shadow 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        filter: drop-shadow(0 0 0 white);
    `,
    hover: {
        transform: 'scale(1.1)',
        boxShadow: '0 6px 16px rgba(10, 102, 194, 0.5)'
    },
    normal: {
        transform: 'scale(1)',
        boxShadow: '0 4px 12px rgba(10, 102, 194, 0.4)'
    }
};

const BUTTON_ICON_SVG = `<svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z"/><path d="M19 2L19.94 4.06L22 5L19.94 5.94L19 8L18.06 5.94L16 5L18.06 4.06L19 2Z" opacity="0.7"/><path d="M5 16L5.66 17.34L7 18L5.66 18.66L5 20L4.34 18.66L3 18L4.34 17.34L5 16Z" opacity="0.7"/></svg>`;
