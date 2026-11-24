import React from "react";

export default function JellyfishAvatar({ size = 42, className = "" }) {
  return (
    <div className={`jellyfish-avatar ${className}`} style={{ width: size, height: size }} aria-label="Аватар">
      <svg viewBox="0 0 100 100" role="img">
        <defs>
          <linearGradient id="jelly-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#b9a4ff" />
            <stop offset="100%" stopColor="#7b6cf6" />
          </linearGradient>
        </defs>
        <path d="M18 49 C18 26 32 13 50 13 C68 13 82 26 82 49 C82 58 72 62 50 62 C28 62 18 58 18 49Z" fill="url(#jelly-body)" />
        <path d="M27 62 C22 72 31 77 26 87 M42 62 C38 73 48 79 43 91 M58 62 C63 72 53 81 61 89 M73 62 C80 72 69 79 77 86" fill="none" stroke="#b9a4ff" strokeWidth="5" strokeLinecap="round" />
        <circle cx="40" cy="43" r="3" fill="#242033" />
        <circle cx="60" cy="43" r="3" fill="#242033" />
        <path d="M44 51 Q50 56 56 51" fill="none" stroke="#242033" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}