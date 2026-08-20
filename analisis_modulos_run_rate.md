# Módulos y su participación en el Run Rate

Análisis de cada módulo pedido, su función, y si interviene o no en el cálculo del Run Rate.
Complementa a [`analisis_run_rate.md`](analisis_run_rate.md), que documenta la fórmula en detalle.

Fecha del análisis: 2026-08-14. Verificado contra el código, no de memoria.

---

## Punto de partida: cómo se calcula hoy

```
Horas Programadas Ajustadas = max(Horas Programadas − Deducción de Almuerzo, 0)
Run Rate %                  = (Horas Reales / Horas Programadas Ajustadas) × 100
```

Tres hechos que determinan todo lo demás:

1. **El backend no calcula el porcentaje.** Entrega tres números crudos (`daily_actual`,
   `daily_scheduled`, `lunch_deduction_hours`) y el `%` se calcula en el frontend, repetido en 5
   componentes. La lógica SQL compartida vive en `public/api/RunRateWindowSql.php`, consumida por
   `get_daily_run_rate.php` (día a día) y `get_dashboard_stats.php` (MTD).

2. **La única fuente de horas es `desktime_employee_data`**, que se llena desde la API de DeskTime.
   Esa tabla solo contiene días ya sincronizados.

3. **La ventana es siempre hacia atrás**: `from = date('Y-m-01')`, `to = hoy`. No existe ninguna
   consulta de run rate que mire una fecha futura.

De ahí se desprende la conclusión central de este documento: **todo lo que produce horarios futuros
no participa del run rate actual.**

---

## Modules

### Schedule Board

**Qué hace.** Vista semanal de lunes a domingo, de solo lectura, con una tarjeta por empleado y día.
Los días pasados y el actual muestran lo que DeskTime registró; los días futuros muestran una
proyección resuelta en `get_schedule_board.php` con cuatro niveles de prioridad:

```
feriado Non-Working del equipo
  → patrón de Shift Management que cubra la fecha
    → override manual de Forecast
      → patrón por día de la semana (últimas 6 semanas)
        → turno histórico más frecuente
```

**Participación en el Run Rate: ninguna directa.**

Es la observación más importante del análisis. El board y el run rate leen la misma tabla de turnos,
pero el run rate **nunca lee las proyecciones del board**. Son dos caminos paralelos: el board
proyecta hacia adelante, el run rate mide hacia atrás. Comparten el componente de tarjeta
(`ShiftCard.jsx`) y la tabla de origen, nada más.

---

### Shift Management

**Qué hace.** Búsqueda de empleado y edición visual de su patrón semanal (lunes–domingo) con las
mismas tarjetas del Schedule Board. Permite editar horas, marcar Off Day, duplicar un turno a varios
días y aplicar el patrón hasta una fecha elegida. Guarda **versiones** en
`org_shift_schedule_patterns`, de modo que un horario reemplazado queda en el historial.

**Participación en el Run Rate: ninguna directa hoy.**

Escribe exactamente el dato que un Run Rate Forecast necesitaría —horas programadas para fechas
futuras— pero ningún cálculo de run rate lo consume. Es el insumo que hoy está disponible y sin usar.

---

### Forecast (Configuration → Scheduling → Forecast)

**Qué hace.** Fija una semana histórica como patrón de origen y la proyecta hacia adelante hasta una
semana final elegida, por empleado. Permite rellenar días sin datos o marcarlos OFF antes de guardar.
Un solo registro vigente por empleado en `org_schedule_forecast_overrides`.

**Participación en el Run Rate: ninguna directa.**

Igual que Shift Management: alimenta el board, no el run rate. Al aplicar un horario desde Shift
Management sobre el mismo rango, este override queda supeditado y se elimina si el nuevo período lo
cubre por completo.

> **Nota de solapamiento.** Shift Management y Forecast hacen casi lo mismo sobre horizontes
> distintos y conviven por decisión explícita. La precedencia entre ambos está fijada en
> `get_schedule_board.php`; si en el futuro se busca simplificar, este es el candidato natural a
> consolidar.

---

### Holidays

**Qué hace.** Calendario de feriados de la organización (nombre, fecha, país, tipo, descripción) con
alta individual, carga masiva e importación, y generación de feriados oficiales. El **tipo** por
defecto se define aquí, y cada equipo puede sobreescribirlo desde
`Employees → Teams → Assign Members → Holidays`.

**Participación en el Run Rate: DIRECTA.** Es el único de los cuatro módulos que interviene.

| Tipo efectivo del equipo | Efecto en el Run Rate |
|---|---|
| **Non-Working** | El día desaparece del run rate de ese equipo: no suma ni al numerador ni al denominador. Equivale a una fila en `org_run_rate_excluded_days`. |
| **Working** | Ninguno. El día cuenta normal. |
| **Custom** (con ventana horaria) | Recorta **solo** las horas programadas que caen en la ventana. Las horas rastreadas quedan intactas, así que el run rate de ese día sube. |

El tipo efectivo es `COALESCE(override del equipo, default de la organización)`, así que **la misma
fecha puede contar para un equipo y no para otro**.

Implementado en `RunRateWindowSql.php` (`rrNonWorkingHolidayFilter()` y
`rrCampaignExclusionJoin()`), aplicado en las dos consultas de run rate.

---

## Configuration

### Run Rate Report

**Qué hace.** Dos cosas distintas bajo el mismo nombre:

1. Una entrada en **Manage Active Reports** que solo controla si el reporte se muestra.
2. El panel **Advance Configuration**, que es el verdadero centro de mando: agrupa por equipo los
   cuatro controles siguientes, y administra los **rangos de color**
   (`org_run_rate_color_ranges` vía `manage_run_rate_ranges.php`).

**Participación: indirecta (es el panel de control).** Los rangos de color son **puramente
visuales** — `StatReportView.jsx` los usa para pintar la cifra según su valor. No alteran ningún
número, y **no son una meta**: no existe en ninguna parte un objetivo numérico de run rate contra el
cual comparar.

---

### Exceptions

**Qué hace.** Excluye del run rate en tres niveles:

| Nivel | Tabla | Alcance |
|---|---|---|
| Empleado completo | `org_run_rate_excluded_employees` | Todos sus días |
| Día de todo el equipo | `org_run_rate_excluded_days` | Ese equipo, esa fecha |
| Día de un solo empleado | `org_run_rate_excluded_employee_days` | Solo esa persona, esa fecha |

**Participación: DIRECTA.** Elimina la fila entera, así que desaparecen a la vez las horas reales y
las programadas — a diferencia de un feriado Custom, que solo toca un lado.

**Matiz de implementación.** La exclusión por empleado se aplica distinto en cada endpoint:
`get_daily_run_rate.php` la filtra en SQL, mientras `get_dashboard_stats.php` solo la **marca**
(`is_excluded`) y el filtrado ocurre en el frontend. Es intencional y está documentado en
`StatReportView.jsx`: `RunRateDayExceptionsModal.jsx` necesita esas filas en el payload para poder
mostrar y deshacer una exclusión.

---

### Billable %

**Qué hace.** Un porcentaje por empleado (`org_run_rate_billable_percentage`) que escala sus horas
antes del cálculo. Al 50%, un día de 7.99h/8h se convierte en 3.995h/4h.

**Participación: DIRECTA.** Multiplica **tanto** las horas reales **como** las programadas por el
mismo factor.

> **Observación para revisar.** Como escala los dos lados por igual, en teoría el porcentaje de run
> rate no debería moverse. Pero la **deducción de almuerzo no se escala** — se resta en horas
> absolutas después. Con 8h programadas, 1h de almuerzo y 8h reales:
>
> | | Real | Programada ajustada | Run Rate |
> |---|---|---|---|
> | Sin Billable % | 8.00 | 8 − 1 = 7.00 | 114% |
> | Billable 50% | 4.00 | 4 − 1 = 3.00 | 133% |
>
> El porcentaje cambia por el almuerzo sin escalar. No sé si es intencional; vale la pena confirmarlo
> antes de que alguien lo tome como base de una decisión.

---

### Desktime Time / At Work Time

**Qué hace.** Por equipo (`org_teams.run_rate_time_source`) elige qué campo de DeskTime cuenta como
horas trabajadas:

- **Desktime Time** — tiempo total rastreado por el agente.
- **At Work Time** — presencia entre la primera llegada y la última salida.

**Participación: DIRECTA.** Define el numerador. `At Work Time` siempre da un número mayor o igual,
porque incluye los huecos sin actividad dentro de la jornada.

En el mismo panel vive el toggle **Include Lunch**
(`org_teams.exclude_lunch_from_run_rate`, por defecto apagado), que decide si el almuerzo del equipo
se resta de las horas programadas. Afecta **solo al denominador**.

> **Nota de nomenclatura.** La columna se llama `exclude_lunch_from_run_rate` y la UI lo llama
> "Include Lunch". Ambos nombres apuntan a lo mismo (encendido = el almuerzo se resta), pero leídos
> por separado sugieren lo contrario. Es una fuente probable de confusión al mantener el código.

---

## Resumen de participación

| Módulo | Participa | Qué lado afecta |
|---|---|---|
| Schedule Board | ✗ | — |
| Shift Management | ✗ | (produce horas futuras que nadie consume) |
| Forecast | ✗ | (idem) |
| Holidays | ✓ | Ambos (Non-Working) / solo programadas (Custom) |
| Run Rate Report | indirecto | Solo color; ninguna meta numérica |
| Exceptions | ✓ | Ambos (elimina la fila) |
| Billable % | ✓ | Ambos (escala) — ver observación del almuerzo |
| Desktime / At Work Time | ✓ | Solo reales |
| Include Lunch | ✓ | Solo programadas |

---

## Qué falta para completar el Run Rate Report

### 1. Run Rate Forecast — no existe en absoluto

Ningún componente ni endpoint proyecta el run rate hacia adelante. Para construirlo faltan tres
piezas, y solo una es trabajo mecánico:

**a) Un resolvedor reutilizable de horas programadas futuras.** La lógica ya existe y funciona, pero
está atrapada dentro del armado del pivote de `get_schedule_board.php`. Hay que extraerla —igual que
se hizo con `ShiftSchedulePatterns.php` y `RunRateWindowSql.php`— para que el run rate pueda
preguntar "cuántas horas tiene programadas el empleado X el día futuro D". Es el paso habilitante y
el más directo.

**b) Una fórmula de proyección.** Decisión de producto, no técnica. Como mínimo hay que definir qué
se asume sobre los días que faltan: ¿que se cumplirán al 100%, o al ritmo histórico del propio
empleado/equipo? La forma típica sería:

```
Run Rate Proyectado = (Reales MTD + Programadas restantes × tasa de cumplimiento) / Programadas del mes
```

**c) Una meta.** Hoy no existe ningún objetivo numérico de run rate en la base de datos ni en
configuración. Sin meta se puede proyectar un número, pero no decir si va bien o mal. Los rangos de
color son lo más cercano, y son solo umbrales de pintura.

### 2. Time Off & Availability — placeholder sin implementar

Está en el menú (`time-off`) pero no tiene componente ni ruta.

**Es el hueco funcional más costoso hoy.** Sin él, una ausencia aprobada (vacaciones, licencia,
incapacidad) cuenta como turno completo en el denominador con 0 en el numerador, y **hunde el run
rate del equipo** sin que nada indique que fue una ausencia legítima. La única forma de compensarlo
es registrar la excepción a mano, día por día y persona por persona.

Debería descontar del denominador igual que ya hace un feriado Non-Working.

### 3. Coverage — placeholder sin implementar

Necesario para comparar horas requeridas contra programadas. Sin cobertura, el run rate mide
cumplimiento contra el turno de cada persona, pero no si ese turno era el que el negocio necesitaba.

### 4. Templates, Shift Swaps, History — placeholders sin implementar

Los tres están en el menú sin componente ni ruta. Un cambio de turno aprobado debería mover las horas
programadas; hoy no hay dónde registrarlo.

### 5. Rango de fechas arbitrario en la UI

Los endpoints ya aceptan `from`/`to`, pero el dashboard está fijo en mes a la fecha. No se puede
consultar el run rate de un mes cerrado ni de un rango propio sin llamar la API a mano.

### 6. Almuerzo por turno

Hoy el almuerzo es un único valor por equipo. Un empleado con almuerzo distinto, o un día con almuerzo
más corto, no se puede representar, y eso entra directo al denominador.

---

## Inconsistencias encontradas

Dos cosas que no son "falta un módulo" sino divergencias entre partes que deberían coincidir:

1. **`get_absenteeism_details.php` ignora todas las exclusiones del run rate.** Cero referencias a
   `org_run_rate_excluded_*`, `org_holidays` u `org_team_holiday_types`. Calcula "horas perdidas" con
   la misma lógica de almuerzo que el run rate, pero sin respetar excepciones ni feriados. Un feriado
   Non-Working desaparece del run rate y sigue contando como ausentismo.

2. **Billable % y el almuerzo sin escalar** (detalle en la sección de Billable % más arriba).

---

## Referencias de archivos

| Archivo | Rol |
|---|---|
| `public/api/RunRateWindowSql.php` | Fragmentos SQL compartidos: ventana, recorte, feriados |
| `public/api/get_daily_run_rate.php` | Run rate día a día |
| `public/api/get_dashboard_stats.php` | Run rate MTD agregado |
| `public/api/get_schedule_board.php` | Proyección futura de turnos (4 niveles) |
| `public/api/ShiftSchedulePatterns.php` | Resolución de patrones versionados |
| `public/api/manage_shift_schedule.php` | Shift Management: leer, preview, aplicar |
| `public/api/manage_schedule_forecast.php` | Forecast override |
| `public/api/manage_team_holiday_types.php` | Tipo de feriado por equipo |
| `public/api/manage_run_rate_exceptions.php` | Exclusión por empleado |
| `public/api/manage_run_rate_excluded_days.php` | Exclusión por equipo-día |
| `public/api/manage_run_rate_excluded_employee_days.php` | Exclusión por empleado-día |
| `public/api/manage_run_rate_billable_percentage.php` | Billable % |
| `public/api/manage_run_rate_ranges.php` | Rangos de color |
| `src/components/ShiftCard.jsx` | Tarjeta compartida Board / Shift Management |
| `src/components/ReportSettings.jsx` | Advance Configuration del Run Rate |
| `src/components/StatReportView.jsx` | Reporte Run Rate por organización y equipo |
| `src/components/Dashboard.jsx` | Tarjeta Run Rate MTD |
