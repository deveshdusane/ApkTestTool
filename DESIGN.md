---
name: design
description: Translate Figma designs into TestMate AI's Electron renderer (HTML/CSS) using Figma's Dev Mode MCP server as the source of truth.
type: project
---

# Design System: Linear-Vercel Blue Palette

TestMate AI uses a high-precision, low-noise aesthetic inspired by modern developer tools like Linear and Vercel. The goal is "Information Density with Clarity."

## Color Palette (Dark Theme - Default)
- **Background**: Slate 900 (`#0F172A`)
- **Surface/Card**: Slate 800 (`#1E293B`)
- **Primary**: Blue 500 (`#3B82F6`)
- **Success**: Green 500 (`#22C55E`)
- **Warning**: Yellow 400 (`#FACC15`)
- **Danger**: Red 500 (`#EF4444`)
- **Text Primary**: Slate 100 (`#F1F5F9`)
- **Text Secondary**: Slate 400 (`#94A3B8`)
- **Border**: Slate 700 (`#334155`)

## Color Palette (Light Theme)
- **Background**: Cool off-white (`#F8FAFC`)
- **Surface/Card**: Pure white (`#FFFFFF`)
- **Primary**: Blue 600 (`#2563EB`)
- **Success**: Green 600 (`#16A34A`)
- **Warning**: Amber 500 (`#F59E0B`)
- **Danger**: Red 600 (`#DC2626`)
- **Text Primary**: Slate 900 (`#0F172A`)
- **Text Secondary**: Slate 600 (`#475569`)
- **Border**: Slate 200 (`#E2E8F0`)

## Typography
- **UI/Interface**: 'Outfit', system-ui, sans-serif.
- **Data/Logs/Metrics**: 'JetBrains Mono', monospace.
- **Hierarchy**:
  - H1: 2.2em (Weight 700)
  - Body: 15px (Weight 400)
  - Labels: 13px (Weight 600, Uppercase)
  - Mono: 12px (Tabular-nums)

## Visual Standards
- **Glassmorphism**: Used sparingly on sidebars/overlays. Backdrop-blur: 20px.
- **Radii**: SM: 8px, MD: 12px, LG: 20px.
- **Borders**: 1px solid. Strong borders for active states.
- **Motion**: Fast (150ms) and Smooth (300ms) cubic-bezier transitions.
