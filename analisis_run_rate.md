# Análisis del Run Rate

## Fórmula principal

```
Horas Programadas Ajustadas = max(Horas Programadas − Deducción de Almuerzo, 0)
Run Rate %                  = (Horas Reales / Horas Programadas Ajustadas) × 100   (0% si el denominador es 0)
Horas Faltantes             = max(0, Horas Programadas Ajustadas − Horas Reales)
```

El backend PHP (`public/api/get_daily_run_rate.php`) **no calcula el %** — solo entrega tres números crudos por empleado/día: `daily_actual`, `daily_scheduled`, `lunch_deduction_hours`. Todo el cálculo del porcentaje ocurre en el frontend (JS), repetido de forma consistente en 5 componentes:

- `src/components/DailyDetailsModal.jsx` (por empleado/día, usando `get_daily_run_rate.php`)
- `src/components/Dashboard.jsx` (agregado MTD — Mes a la Fecha, usando `get_dashboard_stats.php`)
- `src/components/Infograph.jsx` (tarjeta KPI resumen)
- `src/components/StatReportView.jsx` (reporte "Run Rate" a nivel organización y por equipo)
- `src/components/DrillDownModal.jsx` (ordenamiento ascendente "para resaltar problemas" y exportación CSV)

El tooltip de `Dashboard.jsx` documenta la fórmula así:
> "(MTD Actual Hours / (MTD Scheduled Hours − Lunch Deduction Hours)) × 100"

## De dónde sale cada número

### 1. Horas Reales (`daily_actual` / `mtd_actual`)
```sql
SUM(d.desktime_time) / 3600
```
Segundos crudos rastreados por DeskTime (`desktime_employee_data.desktime_time`), convertidos a horas. No es "tiempo productivo", es el tiempo total registrado.

### 2. Horas Programadas (`daily_scheduled` / `mtd_scheduled`) — con fallback en dos niveles
```sql
CASE
    WHEN d.work_starts != '00:00:00'
         AND d.work_ends NOT IN ('00:00:00', '23:59:59')
         AND d.work_ends > d.work_starts
    THEN (TIME_TO_SEC(d.work_ends) - TIME_TO_SEC(d.work_starts)) / 3600
    WHEN sched.work_starts IS NOT NULL
    THEN (TIME_TO_SEC(sched.work_ends) - TIME_TO_SEC(sched.work_starts)) / 3600
    ELSE 0
END
```
- Si el turno de ese día es válido (no es medianoche-a-medianoche, no termina en 23:59:59, fin > inicio), se usa la duración de ese turno.
- Si no hay turno válido ese día, se usa el turno histórico **más frecuente** de ese empleado, calculado con:
```sql
SELECT employee_id, work_starts, work_ends
FROM (
    SELECT employee_id, work_starts, work_ends,
           ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY COUNT(*) DESC) as rn
    FROM desktime_employee_data
    WHERE work_starts != '00:00:00'
      AND work_ends NOT IN ('00:00:00', '23:59:59')
      AND work_ends > work_starts
    GROUP BY employee_id, work_starts, work_ends
) ranked
WHERE rn = 1
```
- Si el empleado nunca ha tenido un turno válido, el valor es 0.

### 3. Deducción de Almuerzo (`lunch_deduction_hours`)
```sql
COALESCE(ot.lunch_time, 0) / 60.0
```
`org_teams.lunch_time` está en minutos y se convierte a horas; se aplica siempre que se encontró algún turno (principal o histórico).

## Alcance y filtros de la consulta

- Usuarios no-Admin con `$_SESSION['allowed_teams']` solo ven datos de sus equipos permitidos.
- Equipos/grupos marcados como ocultos (`org_teams.is_visible = 0`, `org_groups.is_visible = 0`) se excluyen siempre.
- El nombre del equipo se resuelve con `COALESCE(ot.name, d.group_name)` — prioriza el nombre configurado en `org_teams`, si no existe usa el grupo crudo de DeskTime.

## Origen de los datos y configuración

| Dato | Tabla/Columna | Se puebla desde |
|---|---|---|
| Horas reales, turnos (`work_starts`, `work_ends`, `desktime_time`) | `desktime_employee_data` | `sync_desktime_core.php` (API de DeskTime), llamado desde `get_dashboard_stats.php` (auto-refresh) y `sync_auto_background.php` (cron diario) |
| Tiempo de almuerzo por equipo | `org_teams.lunch_time` (minutos) | Configurado manualmente en `Teams.jsx` → `manage_org.php`, default 60 min en la UI |
| Asignación de empleados a equipos | `org_team_assignments` | `manage_org.php` (asignación manual vía UI, no viene de Odoo) |
| Visibilidad de equipos/grupos | `org_teams.is_visible`, `org_groups.is_visible` | `manage_org.php`; equipos ocultos se excluyen siempre del run rate |
| Restricción por rol | `$_SESSION['allowed_teams']`, `role_name` | Usuarios no-Admin solo ven sus equipos permitidos |

**No existe** una meta numérica fija de "horas objetivo por día" (ej. 8h/día) en ninguna configuración (`db_wfm_config.php` solo contiene credenciales de conexión, no umbrales de negocio) — el objetivo/esperado siempre es el turno propio de DeskTime de cada empleado, dinámico por persona y por día.

Datos de Odoo (`get_odoo_employees.php`, `sync_odoo_employees.php`) y horas de proyecto (`desktime_project_data`, `sync_project_data.php`) **no** intervienen en el cálculo del run rate — son features separadas.

## Mapeo API → UI

- `get_daily_run_rate.php` → `{employee_id, name, log_date, team_name, daily_actual, daily_scheduled, lunch_deduction_hours}` → consumido solo por `DailyDetailsModal.jsx` (vista día a día).
- `get_dashboard_stats.php`'s `mtdEmployeeData` → `{employee_id, name, team_name, mtd_actual, mtd_scheduled, lunch_deduction_hours}` (misma forma de query, pero agrupada por empleado, no por día) → consumido por `Dashboard.jsx`, `Infograph.jsx` y `StatReportView.jsx`.

## Casos especiales / posibles gaps

1. **Sin turno configurado ese día:** usa el turno histórico más común del empleado; si nunca tuvo uno, ese día aporta 0 al denominador pero el numerador (horas reales) sí puede sumar, lo que puede inflar el % por encima de 100% en casos de empleados nuevos sin horario configurado.
2. **El % mostrado no está topado a 100%** en los componentes (solo la barra de progreso visual se limita con `Math.min(progress,100)`), por lo que overtime o mal-scheduling puede mostrar >100%.
3. **División por cero:** siempre protegida (`adjusted > 0 ? ... : 0`), nunca da `NaN`/`Infinity`.
4. **Deducción de almuerzo mayor al turno:** se topa en 0 con `Math.max(...,0)` en JS (no a nivel SQL).
5. **Turnos inválidos/placeholder** (`work_ends = '00:00:00'` o `'23:59:59'`, o `work_ends <= work_starts`) se excluyen explícitamente de ser tratados como turno válido, tanto en el CASE principal como en el fallback histórico.
6. **Ausentismo/fines de semana/feriados:** no se marcan especialmente; un empleado con turno programado pero sin horas registradas (no-show) cuenta su turno completo en el denominador con 0 en el numerador, bajando el run rate. Esto es consistente con `get_absenteeism_details.php`, que usa la misma lógica de deducción de almuerzo (`GREATEST(TIME_TO_SEC(work_ends)-TIME_TO_SEC(work_starts) - lunch_time*60, 0)`) para calcular "horas perdidas".
7. **Filtros adicionales del dashboard** (`billableFilter`, `groupFilter`, `searchTerm`, `chartFilter`) se aplican en `Dashboard.jsx` antes de sumar `mtd_actual`/`mtd_scheduled`/`lunch_deduction_hours` — no cambian la fórmula, solo la población de empleados sobre la que se calcula.

## Referencias de archivos

- `public/api/get_daily_run_rate.php` — endpoint que entrega los datos crudos día a día.
- `public/api/get_dashboard_stats.php` — endpoint que entrega los datos agregados MTD.
- `public/api/get_absenteeism_details.php` — métrica relacionada de "horas perdidas" con lógica de deducción de almuerzo similar.
- `public/api/sync_desktime_core.php` — sincroniza `desktime_employee_data` desde la API de DeskTime.
- `public/api/sync_auto_background.php` — cron diario que dispara la sincronización.
- `public/api/manage_org.php` — gestiona equipos, `lunch_time` y asignaciones.
- `src/components/Dashboard.jsx`, `DailyDetailsModal.jsx`, `Infograph.jsx`, `StatReportView.jsx`, `DrillDownModal.jsx` — consumidores del cálculo en el frontend.
