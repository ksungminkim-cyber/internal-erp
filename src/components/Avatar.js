'use client';

const GRADIENTS = [
  'linear-gradient(135deg, #3182f6 0%, #5e9aff 100%)',
  'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
  'linear-gradient(135deg, #14b8a6 0%, #06b6d4 100%)',
  'linear-gradient(135deg, #ff9a3c 0%, #ff5d5d 100%)',
  'linear-gradient(135deg, #ec4899 0%, #f59e0b 100%)',
  'linear-gradient(135deg, #00c896 0%, #36d6a8 100%)',
];

function hash(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export default function Avatar({ name = '', size = 'md', userId }) {
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  const key = userId || name || '';
  const grad = GRADIENTS[hash(key) % GRADIENTS.length];
  const cls = `avatar${size === 'sm' ? ' sm' : size === 'lg' ? ' lg' : ''}`;
  return (
    <div className={cls} style={{ background: grad }}>{initial}</div>
  );
}
