# Frontend Generation Context

- **Platform Type**: Enterprise SaaS Workforce Management (WFM) and Time Tracking Analytics.
- **Business Purpose**: Monitor employee productivity, manage organizational hierarchies, process raw time-tracking data into payroll-ready reports, and manage scheduling.
- **Primary Personas**: WFM Analysts, Supervisors, Department Managers, System Admins.
- **Most Important Dashboards**: Daily Operations Dashboard (real-time attendance, online/offline status), Employee Hours Report (payroll export matrix).
- **Most Important Workflows**: Synchronizing raw data, adjusting hours based on business rules (e.g., 40-hour caps), assigning employees to teams, managing user access.
- **UI Priorities**: 
  - High data density (matrix tables) to allow quick scanning of hundreds of records.
  - Sticky headers and columns for context retention during scrolling.
  - Fast, responsive date filtering with quick presets (e.g., "Last Week").
  - Clear visual hierarchy (KPIs at top, details below).
- **Recommended Architecture**: React-based SPA (e.g., Vite, Next.js, or Remix), using a robust table library (e.g., TanStack Table or AG Grid) for performance, and a comprehensive UI component system (e.g., Radix Primitives + Tailwind CSS or Shadcn UI).
- **Design Direction**: Professional, clean, and modern. Dark mode support is essential. Use accent colors sparingly to highlight actionable data, warnings, or late arrivals. The aesthetic should align with modern enterprise tools like Retool, Workday, or Datadog.
