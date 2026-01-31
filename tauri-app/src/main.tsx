import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/AppMain';
import './styles/retro.css';
import './styles/showdown-battle.css';
import './styles/ps-authentic.css';

const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(<App />);

if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/sw.js').catch(() => undefined);
	});
}

if (navigator.storage?.persist) {
	navigator.storage.persist().catch(() => undefined);
}
