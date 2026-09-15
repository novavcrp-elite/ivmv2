import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Server, LayoutDashboard, Plus, LogOut, X, Settings, Key, User, Activity, Box, Search, Bell, Menu, Cloud, Database, HardDrive } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { UserAvatar } from "./UserAvatar";
import { useSettings } from "../context/SettingsContext";
import { motion, AnimatePresence } from "framer-motion";

type NavItem = { name: string; path: string; icon: ReactNode };
type NavCategory = { label: string; adminOnly?: boolean; placeholder?: string; items: NavItem[] };

export function Sidebar({ onClose, isCollapsed, toggleCollapse }: { onClose?: () => void, isCollapsed?: boolean, toggleCollapse?: () => void }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { panelName, panelLogo } = useSettings();
  
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  // The sidebar is organised into categories. Each category renders its own
  // heading, and an empty category keeps its heading with a muted hint so the
  // future service buttons have a place to render into.
  const navCategories: NavCategory[] = [
    {
      label: "Management",
      items: [
        { name: "Overview", path: "/", icon: <LayoutDashboard size={20} /> },
        ...(isAdmin ? [
          { name: "Nodes", path: "/nodes", icon: <Activity size={20} /> },
          { name: "Fleet", path: "/admin/servers", icon: <Box size={20} /> },
          { name: "API Keys", path: "/api-keys", icon: <Key size={20} /> },
          { name: "Admin Settings", path: "/admin/settings", icon: <Settings size={20} /> },
        ] : []),
      ],
    },
    {
      label: "Servers",
      items: [
        { name: "Servers", path: "/servers", icon: <Server size={20} /> },
        ...(isAdmin ? [{ name: "Deploy", path: "/servers/create", icon: <Plus size={20} /> }] : []),
      ],
    },
    {
      label: "Database",
      items: [
        { name: "Databases", path: "/databases", icon: <Database size={20} /> },
        ...(isAdmin ? [{ name: "Database Hosts", path: "/databases/hosts", icon: <HardDrive size={20} /> }] : []),
      ],
    },
    // Reserved for QEMU-backed virtual machines. It keeps its heading with a
    // placeholder line so the section reads as "not built yet" rather than as a
    // rendering glitch, and the future buttons drop straight into `items`.
    {
      label: "Virtual Machine",
      adminOnly: true,
      placeholder: "QEMU machines — coming soon",
      items: [],
    },
    {
      label: "Account",
      items: [{ name: "Account", path: "/account", icon: <User size={20} /> }],
    },
    {
      label: "Virtual Private Servers",
      adminOnly: true,
      items: [
        { name: "VPS Servers", path: "/vps", icon: <Cloud size={20} /> },
        { name: "Deploy VPS", path: "/vps/deploy", icon: <Plus size={20} /> },
      ],
    },
  ];

  // Highlight exactly one item: an exact path match wins, otherwise the longest
  // matching prefix is used, so /vps/deploy does not also light up /vps.
  const allPaths = navCategories.filter(cat => !cat.adminOnly || isAdmin).flatMap(cat => cat.items.map(i => i.path));
  const activePath = allPaths.find(p => p === location.pathname)
    ?? allPaths.filter(p => p !== "/" && location.pathname.startsWith(p + "/")).sort((a, b) => b.length - a.length)[0];

  return (
    <div className={`h-full flex flex-col bg-ink backdrop-blur-md text-white font-body border-r border-line transition-all duration-300 z-20 ${isCollapsed ? 'w-20' : 'w-64'}`}>
      {/* Header: brand mark + collapse toggle */}
      <div className={`h-16 flex items-center border-b border-line flex-shrink-0 relative ${isCollapsed ? 'justify-center' : 'justify-between px-4'}`}>
        {!isCollapsed && panelLogo && (
          <img src={panelLogo} alt="Logo" className="h-8 w-8 rounded-lg object-cover ring-1 ring-white/10" />
        )}
        {onClose && (
          <button onClick={onClose} className="md:hidden flex items-center justify-center absolute top-5 right-4 p-2 text-dim hover:text-white hover:bg-line/50 rounded-lg transition-colors">
            <X size={20} />
          </button>
        )}
        <button 
          onClick={toggleCollapse}
          className="p-2 text-dim hover:text-white hover:bg-white/[0.05] rounded transition-colors hidden md:flex"
          title="Toggle Sidebar"
        >
          <Menu size={20} />
        </button>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 w-full px-3 py-6 overflow-y-auto custom-scrollbar">
        {navCategories.filter(cat => !cat.adminOnly || isAdmin).map((cat, index) => (
          <div key={cat.label} className={index === 0 ? "" : "mt-6"}>
            {isCollapsed
              ? index > 0 && <div className="mx-3 mb-3 border-t border-line" />
              : <p className="px-3 mb-2 font-mono text-[10px] text-faint tracking-widest uppercase">{cat.label}</p>}
            {/* Collapsed mode has no room for a hint, so the divider above is all it shows. */}
            {cat.items.length === 0 && !isCollapsed && cat.placeholder && (
              <p className="px-3 py-1 font-mono text-[10px] text-faint/70 tracking-wide">{cat.placeholder}</p>
            )}
            <div className="space-y-1.5">
              {cat.items.map(link => {
                const isActive = link.path === activePath;
                return (
                  <Link 
                    key={link.path} 
                    to={link.path} 
                    onClick={onClose}
                    title={isCollapsed ? link.name : undefined}
                    className={`relative flex items-center ${isCollapsed ? 'justify-center' : 'px-3'} py-3 rounded transition-colors group overflow-hidden`}
                  >
                    {isActive && (
                      <motion.div 
                        layoutId="activeTabSidebar" 
                        className="absolute inset-0 bg-white/[0.05]" 
                        initial={false} 
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                    {isActive && !isCollapsed && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-white" />
                    )}
                    <div className={`relative z-10 transition-colors duration-200 ${isActive ? 'text-white' : 'text-dim group-hover:text-white'}`}>
                      {link.icon}
                    </div>
                    {!isCollapsed && (
                      <span className={`ml-3 relative z-10 font-mono text-xs leading-tight tracking-wider transition-colors duration-200 ${isActive ? 'text-white font-semibold' : 'text-dim group-hover:text-white'}`}>
                        {link.name.toUpperCase()}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      

      
      {/* User Profile & Version */}
      <div className="w-full p-4 border-t border-line mt-auto bg-panel">
        {!isCollapsed && (
          <div className="mb-3 px-1 flex items-center justify-between font-mono text-[10px] text-faint">
            <span className="tracking-wider">IVM PANEL</span>
            <span className="text-theme-500 font-semibold px-1.5 py-0.5 rounded bg-theme-500/10 border border-theme-500/20">v3.0.0</span>
          </div>
        )}
        {isCollapsed ? (
          <button onClick={logout} title="Logout" className="flex items-center justify-center w-full p-2 text-dim hover:bg-white/[0.05] hover:text-white transition-colors">
            <LogOut size={20} />
          </button>
        ) : (
          <div className="flex items-center justify-between group cursor-pointer hover:bg-white/[0.02] p-2 -mx-2 rounded transition-colors">
            <div className="flex items-center gap-3 overflow-hidden">
              <UserAvatar user={user} size="h-9 w-9" shape="rounded-lg" />
              <div className="truncate">
                <p className="font-mono text-xs font-semibold text-white truncate uppercase">{user?.username}</p>
                <p className="font-mono text-[10px] text-faint tracking-widest capitalize truncate">{user?.role || "Admin"}</p>
              </div>
            </div>
            <button onClick={logout} className="p-2 text-faint hover:text-white transition-colors flex-shrink-0">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
