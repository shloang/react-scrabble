# Design Guidelines: Russian Scrabble (Эрудит) Game

## Design Approach
**System-Based Approach** using Material Design principles adapted for board game clarity. Focus on functional hierarchy, readable typography for Cyrillic characters, and clear visual states for interactive elements.

**Core Principle**: Maximize board visibility and game state awareness while maintaining clean, uncluttered interface.

## Layout System

**Spacing Scale**: Use Tailwind units of 2, 4, 6, and 8 consistently (p-2, gap-4, m-6, py-8)

**Primary Layout Structure**:
- Full viewport application (h-screen) with no scroll
- Three-column desktop layout: Left sidebar (player info/scores) | Center (game board) | Right sidebar (tile rack/controls)
- Mobile: Stacked vertical layout (players → board → rack)
- Board should be the dominant visual element, taking 60% of viewport width on desktop
- Container max-width: Board adapts to viewport with max 800px, always square aspect ratio

## Typography

**Font Family**: 
- Primary: 'Inter' or 'Roboto' from Google Fonts for Latin UI elements
- Cyrillic tiles: 'Noto Sans' for optimal Cyrillic character rendering

**Hierarchy**:
- Tile letters: text-2xl font-bold (large, highly legible)
- Player names: text-lg font-semibold
- Scores: text-3xl font-bold (prominent)
- Timer: text-4xl font-mono font-bold (countdown needs high visibility)
- Point values on tiles: text-xs (subscript style, bottom-right)
- Board square labels: text-xs uppercase tracking-wide

## Component Library

### Game Board
- 15×15 grid with equal square cells
- Cell size: Responsive (calc based on viewport), minimum 40px
- Grid gap: gap-1 (thin borders between cells)
- Board container: Rounded corners (rounded-lg), shadow-xl for elevation

### Special Squares (when empty)
- Display abbreviated labels (TW, DW, TL, DL) centered
- Pattern/texture treatment for visual distinction
- Border treatment: border-2 with opacity variations

### Tiles
- Rounded squares (rounded-md)
- Elevation: shadow-md for tiles in rack, shadow-sm for placed tiles
- Letter centered with point value in bottom-right corner
- Draggable appearance: cursor-pointer with subtle border
- Selected state: Ring treatment (ring-4) with brightness increase

### Player Dashboard (Left Sidebar)
- Vertical stack of player cards
- Each card contains: Player name, score (large), turn indicator
- Active player card: Elevated with stronger shadow, border accent
- Player color indicator: 4px left border stripe
- Gap between cards: gap-4

### Tile Rack (Right Sidebar or Bottom on Mobile)
- Horizontal flex row of 7 tile slots
- Empty slots: Dashed border to indicate available space
- Controls below rack: Shuffle and Recall buttons with gap-2

### Timer Display
- Circular or semi-circular progress indicator
- Positioned above or within tile rack area
- Critical state (<30s): Pulsing animation, urgent color treatment
- Display format: "2:45" (minutes:seconds)

### Action Buttons
- Primary actions (Submit Move): Large (px-8 py-3), high contrast
- Secondary actions (Skip Turn, Shuffle): Medium (px-6 py-2.5)
- Icon + text combination for clarity
- Disabled state: Reduced opacity (opacity-50), cursor-not-allowed

### Validation Messages
- Toast-style overlay positioned top-center of board
- Temporary display (3-second auto-dismiss for errors)
- Success state: Border and icon treatment
- Error state: Border and icon treatment with list of invalid words

### Join Game Screen
- Centered modal overlay (max-w-md)
- Player name input field (full width)
- Join button (w-full, large)
- Game status: Player count display (X/3 players)

## Visual Hierarchy

**Z-Index Layers**:
1. Board (base)
2. Tiles on board (z-10)
3. Player dashboards (z-20)
4. Tile rack (z-20)
5. Validation messages (z-50)
6. Join modal (z-50)

**Focus States**:
- Current player's entire sidebar panel: Subtle glow effect (ring-2 ring-offset-2)
- Selected tile: Scale transform (scale-105) + ring
- Hoverable squares: Opacity change (hover:opacity-80)

## Responsive Breakpoints

**Desktop (lg: 1024px+)**:
- Three-column layout
- Board: 800px max, centered in middle column
- Sidebars: 280px each

**Tablet (md: 768px)**:
- Two-column: Board + combined sidebar
- Board: 600px max

**Mobile (base: <768px)**:
- Single column stack
- Board: Full width minus padding (p-4)
- Tile rack: Fixed bottom position (sticky bottom-0)
- Player info: Horizontal scroll or compact cards

## Accessibility

- All interactive elements: Minimum 44×44px touch targets
- Keyboard navigation: Tab through tiles, Enter to select/place
- Focus indicators: Visible ring on all focusable elements
- Screen reader labels: aria-labels for all game state elements
- High contrast mode support: Ensure special squares distinguishable without color alone

## Images

**No hero images** - This is a functional game application where the board is the primary visual element. Images are not required for this interface.