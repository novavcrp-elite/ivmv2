import React from "react";

/**
 * Avatar for a panel user.
 *
 * Accounts normally have no picture (only Google sign-in stores one), so instead of
 * showing the first letter of the username this renders a neutral "person" glyph.
 */
export function UserAvatar({
  user,
  size = "h-9 w-9",
  shape = "rounded-lg",
  className = "",
}: {
  user?: { username?: string; photoURL?: string; avatar?: string; profileImage?: string } | null;
  size?: string;
  shape?: string;
  className?: string;
}) {
  const src = user?.photoURL || user?.avatar || user?.profileImage;
  const base = `${size} ${shape} flex items-center justify-center overflow-hidden flex-shrink-0 ring-1 ${className}`;

  if (src) {
    return (
      <img
        src={src}
        alt={user?.username ? `${user.username} avatar` : "User avatar"}
        className={`${base} object-cover ring-white/10`}
      />
    );
  }

  return (
    <div className={`${base} bg-theme-600/15 text-theme-400 ring-theme-600/30`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="8.6" r="4.1" fill="currentColor" />
        <path d="M12 14.3c-4.2 0-7.6 2.7-7.6 6.5h15.2c0-3.8-3.4-6.5-7.6-6.5Z" fill="currentColor" />
      </svg>
    </div>
  );
}

export default UserAvatar;
