import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff } from 'lucide-react';
import './MilestonesPdfDesigner.css';
import { MONTHS, plural, dayLabel } from '../utils/milestones';

/**
 * HR > Milestones > Design PDF — a print layout editor for the month's milestones.
 *
 * It owns no data. The birthdays and anniversaries arrive as props from the Milestones
 * screen, already produced by get_hr_milestones.php, so the age, the years of service, the
 * active-employee filter and the exclusion of nought-year anniversaries are all decided in
 * exactly one place. This file is presentation only.
 *
 * The PDF itself is the browser's own print output, which is how this project already
 * produces printable reports (see the print rules in HoursReportView.css). That choice is
 * what makes "the PDF matches the preview" true by construction rather than by effort: the
 * page below is laid out in real inches and is literally the thing that prints. Text stays
 * vector, so names remain selectable and searchable in the PDF, and no rendering library
 * has to be trusted to reproduce the layout a second time.
 */

const PAGE_SIZES = {
    letter: { label: 'Letter', width: 11, height: 8.5, css: 'letter' },
    a4: { label: 'A4', width: 11.69, height: 8.27, css: 'A4' }
};

/**
 * Only stacks that resolve without a web font download. A font that fails during printing
 * silently reflows the whole page, so Manrope — which this project does not bundle — is
 * deliberately absent rather than offered and broken.
 */
const FONTS = [
    { id: 'focus', label: 'FOCUS (Inter)', stack: "Inter, system-ui, 'Segoe UI', Avenir, Helvetica, Arial, sans-serif" },
    { id: 'helvetica', label: 'Helvetica / Arial', stack: "Helvetica, Arial, sans-serif" },
    { id: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
    { id: 'times', label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
    { id: 'trebuchet', label: 'Trebuchet MS', stack: "'Trebuchet MS', Tahoma, sans-serif" },
    { id: 'verdana', label: 'Verdana', stack: "Verdana, Geneva, sans-serif" }
];

/**
 * How an uploaded image meets the page.
 *
 * Named for what they do rather than for the CSS keyword behind them: "Contain" is the
 * one that fits the whole image on the page without distorting it, and nobody reading the
 * panel could be expected to know that.
 */
const BACKGROUND_FITS = [
    { id: 'cover', label: 'Fill', hint: 'Fills the page, keeping the image’s proportions. The edges that do not fit are cropped.' },
    { id: 'contain', label: 'Fit', hint: 'Fits the whole image on the page, keeping its proportions. Any page left over stays blank.' },
    { id: 'stretch', label: 'Stretch', hint: 'Stretches the image to the page edges. This is the only one that distorts it.' }
];

const BACKGROUND_POSITIONS = [
    ['left top', '↖'], ['center top', '↑'], ['right top', '↗'],
    ['left center', '←'], ['center center', '•'], ['right center', '→'],
    ['left bottom', '↙'], ['center bottom', '↓'], ['right bottom', '↘']
];

const DATE_STYLES = [
    { id: 'badge', label: 'Badge' },
    { id: 'simple', label: 'Simple' },
    { id: 'inline', label: 'Inline' },
    { id: 'large', label: 'Large' }
];

/**
 * What a double-click on the preview lands on, most specific first: a day number sits
 * inside an entry, which sits inside a box, and the first match wins. Anything that
 * matches none of them is the page itself.
 */
const EDITABLE_PARTS = [
    ['.pdfd-entry-day', 'date'],
    ['.pdfd-entry-name', 'name'],
    ['.pdfd-entry-meta', 'meta'],
    ['.pdfd-entry', 'name'],
    ['.pdfd-section-title', 'heading'],
    ['.pdfd-title', 'title'],
    ['.pdfd-subtitle', 'subtitle'],
    ['.pdfd-section', 'box']
];

/**
 * The invisible grips around a box, named by the edges each one moves: a side moves one
 * edge, a corner two. Any of them resizes, so the box behaves like a window rather than
 * needing one particular corner found and grabbed.
 */
const GRIPS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const SETTINGS_KEY = 'focus.milestones.pdf.settings';

/** Shown by the “i” beside every field whose text is run through fill(). */
/** What the day numbers show until a colour is picked: the birthday pink, with the
 *  anniversaries keeping their own blue until one colour is chosen for both. */
const DEFAULT_DAY_COLOR = '#be185d';

const PLACEHOLDER_HELP = 'Placeholders: {MONTH} {YEAR} {MONTH_YEAR} {BIRTHDAY_COUNT} {ANNIVERSARY_COUNT}';

const DEFAULTS = {
    pageSize: 'letter',
    content: 'birthdays',
    showAge: false,
    title: 'Employee Milestones',
    subtitle: '{MONTH_YEAR}',
    birthdayHeading: 'Birthdays',
    anniversaryHeading: 'Work Anniversaries',
    // Each heading can be left off the sheet without losing the text that was typed into
    // it, which is the point: a poster with its own printed banner wants no title, and the
    // wording should still be there when it is switched back on.
    showTitle: true,
    showSubtitle: true,
    showBirthdayHeading: true,
    showAnniversaryHeading: true,
    // null = decided by the content. Two sections share the sheet, so each gets half the
    // width, and three columns in half a page wrap most names onto a second line -- which
    // is what pushed a busy month past the bottom of its box. Explicit once the user picks
    // a number.
    columns: null,
    fontId: 'focus',
    fontSize: 13,
    lineSpacing: 1.6,
    columnGap: 28,
    sectionGap: 28,
    verticalOffset: 0,
    dateStyle: 'badge',
    titleSize: 30,
    titleColor: '#0f2942',
    subtitleSize: 12,
    subtitleColor: '#64748b',
    nameColor: '#1e293b',
    nameBold: false,
    headingSize: 17,
    headingColor: '#0f2942',
    // Each piece of text keeps the weight it already had as its "bold", and drops to 400
    // when switched off, so the defaults below render exactly the page that existed before
    // these controls did.
    titleBold: true,
    subtitleBold: true,
    headingBold: true,
    dayBold: true,
    // null leaves the day numbers their per-kind pink and blue. A colour chosen here
    // applies to both, which is the only thing one control can honestly mean.
    dayColor: null,
    // The trailing "34 years old" / "5 years" on each entry.
    metaColor: '#94a3b8',
    // Free placement is on: the boxes are meant to be moved around an uploaded background,
    // and having to find a switch first would hide that.
    freeBoxes: true,
    // Fill and opacity are always explicit. The frame is not: null means "arrange it", and
    // only a drag, a resize or one of the position sliders turns it into real coordinates.
    // That is what lets the default page look right in either content mode -- one section
    // spans the sheet, two sit side by side -- without the user having to lay them out
    // before they have chosen what to print.
    boxStyles: {
        birthday: { bg: '#fdf2f8', opacity: 100 },
        anniversary: { bg: '#eff6ff', opacity: 100 }
    },
    boxFrames: { birthday: null, anniversary: null },
    background: null,
    backgroundFit: 'cover',
    backgroundPosition: 'center center',
    backgroundOpacity: 100
};

/**
 * Splits the list across columns, top to bottom, then on to the next column.
 *
 * The remainder is spread one row at a time, so eighteen names over five columns go
 * 4/4/4/3/3. The alternative -- filling each column to a fixed ceil(n/columns) quota --
 * used to be offered as "fill column by column" and is gone: it left the last column
 * ragged, and at twenty-five names over six columns it left that column completely empty,
 * printing a blank sixth of the sheet.
 */
const distribute = (items, columns) => {
    const result = Array.from({ length: columns }, () => []);
    if (items.length === 0) return result;

    const base = Math.floor(items.length / columns);
    const remainder = items.length % columns;
    let cursor = 0;
    for (let c = 0; c < columns; c++) {
        const take = base + (c < remainder ? 1 : 0);
        result[c] = items.slice(cursor, cursor + take);
        cursor += take;
    }
    return result;
};

/**
 * Lines a piece of text takes at a given width, wrapped the way a browser wraps it.
 *
 * Dividing the character count by the line length is what an earlier version did, and it
 * is far too generous: text breaks between words, so a column fourteen characters wide
 * fits one seven-letter word and wastes the rest of the line. That optimism made three
 * narrow columns look like the shortest layout for May when they were in fact the tallest.
 */
const wrapLines = (text, charsPerLine) => {
    let lines = 1;
    let used = 0;
    for (const word of String(text).split(/\s+/)) {
        const candidate = used === 0 ? word.length : used + 1 + word.length;
        if (candidate <= charsPerLine) {
            used = candidate;
        } else {
            lines += 1;
            used = word.length;
        }
    }
    return lines;
};

const estimateHeight = (items, columns, boxWidthPx, fontSize, lineSpacing, columnGap, showAge) => {
    const columnWidth = (boxWidthPx - (columns - 1) * columnGap) / columns;
    // The day badge and its gap come off the top before any name is measured.
    const textWidth = Math.max(24, columnWidth - fontSize * 2.6);
    // 0.5em is a serviceable average advance for mixed-case Latin text.
    const charsPerLine = Math.max(4, Math.floor(textWidth / (fontSize * 0.5)));

    const lines = items.reduce((total, item) => {
        // The meta reads as one more word on the same line, and drops to its own when it
        // no longer fits -- which is exactly what the wrap below works out.
        const meta = item.type === 'anniversary'
            ? ` ${item.years} years`
            : (showAge && item.age ? ` ${item.age} years old` : '');
        return total + wrapLines(item.name + meta, charsPerLine);
    }, 0);

    // Whole rows, since a column holds whole entries.
    const perColumn = Math.ceil(items.length / columns);
    const averageLines = lines / Math.max(1, items.length);
    return perColumn * averageLines * fontSize * lineSpacing;
};

const autoColumns = (items, boxWidthPx, fontSize, lineSpacing, columnGap, showAge) => {
    if (items.length === 0) return 1;

    let best = 1;
    let bestHeight = Infinity;
    for (let columns = 1; columns <= 4; columns++) {
        if (columns > items.length) break;
        const height = estimateHeight(items, columns, boxWidthPx, fontSize, lineSpacing, columnGap, showAge);
        // Strictly shorter to win, so a tie keeps the fewer columns and the wider names.
        if (height < bestHeight - 1) {
            bestHeight = height;
            best = columns;
        }
    }
    return best;
};

const autoFrame = (kind, content, top) => (
    content === 'both'
        ? (kind === 'birthday'
            ? { x: 3, y: top, w: 47, h: null }
            : { x: 52, y: top, w: 45, h: null })
        : { x: 4, y: top, w: 92, h: null }
);

/**
 * A null height means "as tall as the month needs".
 *
 * A fixed height was the reason a busier month raised the overflow warning the moment it
 * was selected: September's eighteen names fit the box, December's twenty-five did not,
 * and nothing about picking a month should ask the user to go and resize anything. The box
 * now grows and shrinks with the list, capped at what is left of the sheet below it -- and
 * the warning stays for the case it was really meant for, which is a layout that cannot
 * fit however the box is sized.
 */
const heightStyle = (frame) => (
    frame.h === null
        ? { height: 'auto', maxHeight: `${Math.max(10, 97 - frame.y)}%` }
        : { height: `${frame.h}%` }
);

/**
 * The design as it was left last time.
 *
 * Merged over DEFAULTS rather than used as-is: a design stored before this file grew a
 * setting would otherwise come back missing it, and the page would render with undefined
 * sizes. The two nested objects are merged a level deeper for the same reason.
 */
const storedSettings = () => {
    try {
        const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
        if (!stored || typeof stored !== 'object') return DEFAULTS;

        return {
            ...DEFAULTS,
            ...stored,
            boxStyles: {
                birthday: { ...DEFAULTS.boxStyles.birthday, ...(stored.boxStyles?.birthday || {}) },
                anniversary: { ...DEFAULTS.boxStyles.anniversary, ...(stored.boxStyles?.anniversary || {}) }
            },
            boxFrames: { ...DEFAULTS.boxFrames, ...(stored.boxFrames || {}) }
        };
    } catch {
        // Unreadable or blocked storage is not worth a broken screen over.
        return DEFAULTS;
    }
};

const MilestonesPdfDesigner = ({ birthdays, anniversaries, month, year, onClose, onChangeMonth }) => {
    const [settings, setSettings] = useState(storedSettings);
    const [overflow, setOverflow] = useState(0);
    const [notice, setNotice] = useState(null);
    const [previewScale, setPreviewScale] = useState(1);
    // Where an automatically placed box starts, as a percentage of the page: just below
    // whatever the title and subtitle actually occupy. Measured rather than guessed -- a
    // fixed 22% wasted seventy pixels at the default title size, and that was the margin a
    // heavy month like March needed. Nothing here feeds back into the header's own height,
    // so the measurement settles in one pass.
    const [headerBottom, setHeaderBottom] = useState(15);
    // The floating editor opened by double-clicking the preview: which part, which box it
    // belongs to, and where on screen the click was.
    const [editing, setEditing] = useState(null);

    const bodyRef = useRef(null);
    const stageRef = useRef(null);
    const scalerRef = useRef(null);
    const dragRef = useRef(null);
    const quotaWarned = useRef(false);
    const pageRef = useRef(null);

    const set = (key, value) => setSettings(current => ({ ...current, [key]: value }));

    /** The frame in force: the one the user placed, or the arranged one. */
    const frameOf = (kind, state = settings) => state.boxFrames[kind] || autoFrame(kind, state.content, headerBottom);

    const setStyle = (kind, key, value) => setSettings(current => ({
        ...current,
        boxStyles: { ...current.boxStyles, [kind]: { ...current.boxStyles[kind], [key]: value } }
    }));

    /**
     * Writing a frame is what takes the box off the automatic arrangement.
     *
     * Only the key being set is made explicit: nudging X must not also pin the height, or
     * the box stops growing with the month the moment it is moved.
     */
    const setFrame = (kind, key, value) => setSettings(current => {
        const base = frameOf(kind, current);
        const next = { ...base, [key]: value };
        if (key !== 'h' && current.boxFrames[kind]?.h == null) next.h = null;
        return { ...current, boxFrames: { ...current.boxFrames, [kind]: next } };
    });

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    /**
     * Opens the floating editor for whatever sits under the pointer.
     *
     * The element is looked up from the coordinates rather than taken from event.target:
     * a box takes pointer capture on pointerdown so it can be dragged, and that retargets
     * the double-click to the box itself -- every date and name inside it would open the
     * box's editor instead of their own.
     */
    const onPreviewDoubleClick = (event) => {
        const pageEl = pageRef.current;
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        if (!pageEl || !hit || !pageEl.contains(hit)) return;

        // A double-click also selects the word under it, which would sit highlighted
        // behind the editor.
        window.getSelection()?.removeAllRanges();

        const match = EDITABLE_PARTS.find(([selector]) => hit.closest(selector));
        const sectionEl = hit.closest('.pdfd-section');
        setEditing({
            part: match ? match[1] : 'page',
            kind: sectionEl?.classList.contains('is-anniversary') ? 'anniversary' : 'birthday',
            x: event.clientX,
            y: event.clientY
        });
    };

    // Dragging works in percentages of the page, so it behaves the same whatever the
    // preview happens to be scaled to and lands identically on paper.
    const startDrag = (kind, mode) => (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);

        const pageRect = event.currentTarget.closest('.pdfd-page').getBoundingClientRect();
        const sectionRect = event.currentTarget.closest('.pdfd-section').getBoundingClientRect();
        const frame = frameOf(kind);

        dragRef.current = {
            kind,
            mode,
            startX: event.clientX,
            startY: event.clientY,
            // An auto-height box has no number to drag from, so the height it is currently
            // rendering at becomes the starting point -- for the arithmetic only. Whether it
            // stays automatic is decided in onDragMove, by which grip was grabbed.
            box: { ...frame, h: frame.h ?? (sectionRect.height / pageRect.height) * 100 },
            keepAutoHeight: frame.h === null,
            rect: pageRect
        };
    };

    const onDragMove = (event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = ((event.clientX - drag.startX) / drag.rect.width) * 100;
        const dy = ((event.clientY - drag.startY) / drag.rect.height) * 100;

        setSettings(current => {
            const box = { ...frameOf(drag.kind, current) };

            const start = drag.box;
            const autoHeight = drag.keepAutoHeight ? null : start.h;

            if (drag.mode === 'move') {
                // Moving fixes where the box sits and nothing else. It used to write the
                // whole frame, which quietly froze the height as well: from the first nudge
                // onwards the box stopped following the month, which looked exactly like
                // auto-sizing being broken. Only a top, bottom or corner grip sets a height.
                box.x = clamp(start.x + dx, 0, 100 - start.w);
                box.y = clamp(start.y + dy, 0, 100 - start.h);
                box.h = autoHeight;
            } else {
                // drag.mode names the edges being moved. The opposite edge stays where it
                // was, so dragging the left side grows the box to the left: x and width
                // change together.
                const edges = drag.mode;
                box.x = start.x;
                box.y = start.y;
                box.w = start.w;
                box.h = autoHeight;

                if (edges.includes('e')) box.w = clamp(start.w + dx, 12, 100 - start.x);
                if (edges.includes('w')) {
                    const right = start.x + start.w;
                    box.x = clamp(start.x + dx, 0, right - 12);
                    box.w = right - box.x;
                }
                // A side grip changes the width alone, so a box that grows with the month
                // keeps doing so. Only touching the top or bottom fixes its height.
                if (edges.includes('s')) box.h = clamp(start.h + dy, 10, 100 - start.y);
                if (edges.includes('n')) {
                    const bottom = start.y + start.h;
                    box.y = clamp(start.y + dy, 0, bottom - 10);
                    box.h = bottom - box.y;
                }
            }

            return { ...current, boxFrames: { ...current.boxFrames, [drag.kind]: box } };
        });
    };

    const endDrag = (event) => {
        dragRef.current = null;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    };

    const page = PAGE_SIZES[settings.pageSize];
    const font = FONTS.find(f => f.id === settings.fontId) || FONTS[0];

    const showBirthdays = settings.content === 'birthdays' || settings.content === 'both';
    const showAnniversaries = settings.content === 'anniversaries' || settings.content === 'both';

    /** {MONTH}, {YEAR}, {MONTH_YEAR} and the two counts, so one template serves every month. */
    const fill = (text) => (text || '')
        .replace(/\{MONTH_YEAR\}/g, `${MONTHS[month - 1]} ${year}`)
        .replace(/\{MONTH\}/g, MONTHS[month - 1])
        .replace(/\{YEAR\}/g, String(year))
        .replace(/\{BIRTHDAY_COUNT\}/g, String(birthdays.length))
        .replace(/\{ANNIVERSARY_COUNT\}/g, String(anniversaries.length));

    // Per section, because the two lists are rarely the same length and the box each one
    // gets is a different width.
    const columnsFor = (kind, items) => {
        if (settings.columns !== null) return settings.columns;
        // The box's own width in real pixels, less its padding, which is what the wrapping
        // estimate needs.
        const boxWidthPx = (page.width * 96) * (frameOf(kind).w / 100) - 36;
        return autoColumns(items, boxWidthPx, settings.fontSize, settings.lineSpacing, settings.columnGap, settings.showAge);
    };
    const columnsOf = (kind, items) => distribute(items, columnsFor(kind, items));

    // The preview is laid out in real inches and then scaled to whatever room the stage has.
    // Printing resets the scale to 1 (see the stylesheet), which is why the page that prints
    // is the same element, at its true size.
    // The design outlives the screen: it is kept between openings and between sessions, and
    // only Reset layout clears it. Debounced because dragging a slider would otherwise write
    // to storage on every frame.
    useEffect(() => {
        const timer = setTimeout(() => {
            try {
                // An untouched design is not stored at all. Writing it back would pin today's
                // defaults into storage, and a later change to DEFAULTS would then never
                // reach anyone who had once opened this screen. It is also what makes Reset
                // layout stick: the effect runs again straight after it and would otherwise
                // put the key back.
                if (JSON.stringify(settings) === JSON.stringify(DEFAULTS)) {
                    localStorage.removeItem(SETTINGS_KEY);
                    return;
                }
                localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
            } catch {
                // An uploaded background is a data URL and can run to megabytes, which is
                // the one thing here big enough to blow the storage quota. Everything else
                // is worth keeping, so it is dropped and the user is told once.
                try {
                    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, background: null }));
                    if (!quotaWarned.current) {
                        quotaWarned.current = true;
                        setNotice('That background image is too large to be remembered between sessions. Every other setting is kept.');
                    }
                } catch {
                    // Storage is unavailable altogether; the design simply lasts this session.
                }
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [settings]);

    // Safety net: if a browser never fires afterprint, closing the designer still restores
    // the tab's name rather than leaving it as the last file name.
    useEffect(() => {
        const original = document.title;
        return () => { document.title = original; };
    }, []);

    // Only whether the warning is on screen moves the sheet down, not the count in it.
    const hasWarning = overflow > 0;
    useEffect(() => {
        // Fitted to the height as well as the width, so the whole sheet is in view without
        // scrolling. The height left is measured from where the sheet actually starts, which
        // moves when the overflow warning or a notice appears above it.
        const fit = () => {
            const stage = stageRef.current;
            const scaler = scalerRef.current;
            if (!stage || !scaler) return;
            const styles = getComputedStyle(stage);
            const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
            const padBottom = parseFloat(styles.paddingBottom);
            const top = scaler.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop;

            const byWidth = (stage.clientWidth - padX) / (page.width * 96);
            const byHeight = (stage.clientHeight - top - padBottom) / (page.height * 96);
            setPreviewScale(Math.max(0.1, Math.min(1, byWidth, byHeight)));
        };
        fit();
        const observer = new ResizeObserver(fit);
        if (stageRef.current) observer.observe(stageRef.current);
        return () => observer.disconnect();
    }, [page.width, page.height, hasWarning, notice]);

    // Nothing may be dropped in silence, so the entries are measured against the page after
    // every layout change and anything past the bottom edge is counted and reported.
    useLayoutEffect(() => {
        const pageEl = pageRef.current;
        const inner = bodyRef.current;
        if (!pageEl || !inner) {
            setOverflow(0);
            return;
        }
        // The limit is the page's printable bottom, not the bottom of the list: the list is
        // free to grow, and measuring against itself would report no overflow ever. The
        // rectangle is scaled by the preview transform while the computed padding is not,
        // so the padding is scaled to match before being subtracted.
        const pageRect = pageEl.getBoundingClientRect();
        const header = pageEl.querySelector('.pdfd-subtitle') || pageEl.querySelector('.pdfd-title');
        // Switch both the title and the subtitle off and there is no header left to sit
        // under; the boxes then start at the page's own top padding instead of leaving a
        // gap where the title used to be.
        const headerPx = header
            ? header.getBoundingClientRect().bottom - pageRect.top
            : (parseFloat(getComputedStyle(inner).paddingTop) || 0) * previewScale;
        const next = Math.round(((headerPx / pageRect.height) * 100 + 2) * 10) / 10;
        if (Math.abs(next - headerBottom) > 0.2) setHeaderBottom(next);

        const padding = parseFloat(getComputedStyle(inner).paddingBottom) || 0;
        const pageLimit = pageRect.bottom - padding * previewScale;

        let cut = 0;
        // Queried from the page, not the inner box: freely placed sections live in their own
        // layer outside it.
        pageEl.querySelectorAll('[data-entry]').forEach(entry => {
            let limit = pageLimit;
            if (settings.freeBoxes) {
                // A box the user has dragged small clips its own list long before the sheet
                // runs out, and those names are just as absent from the PDF.
                const box = entry.closest('.pdfd-section');
                if (box) limit = Math.min(limit, box.getBoundingClientRect().bottom);
            }

            // A point of slack: sub-pixel rounding at a fractional scale otherwise reports a
            // row as overflowing when it sits exactly on the line.
            const fallsOffTheBottom = entry.getBoundingClientRect().bottom > limit + 1;

            // Sideways counts too. A column too narrow for a name cuts it mid-word --
            // "Yanet Mayrelys Rodrigue" -- and a half-printed name is as much a missing
            // employee as one pushed off the page. Measured on the text itself, because the
            // row's own box is the column width and never reports the overflow.
            const name = entry.querySelector('.pdfd-entry-name');
            const isCutOff = name && name.scrollWidth > name.clientWidth + 1;

            if (fallsOffTheBottom || isCutOff) cut += 1;
        });
        setOverflow(cut);
    }, [settings, birthdays, anniversaries, month, year, previewScale, headerBottom]);

    const onUpload = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|jpg|webp|gif)$/.test(file.type)) {
            setNotice('That file is not a PNG, JPG, WEBP or GIF image.');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            set('background', reader.result);
            setNotice(null);
        };
        reader.onerror = () => setNotice('The image could not be read.');
        reader.readAsDataURL(file);
    };

    /**
     * "employees_birthdays_september_2026" — what the sheet actually holds.
     *
     * Browsers name a "Save as PDF" after the document title, which is how every export
     * was landing as workforce_platform.pdf. The title is swapped just for the print and
     * put back on afterprint, so the browser tab is not left renamed.
     */
    const pdfFileName = () => {
        const parts = ['employees'];
        if (showBirthdays) parts.push('birthdays');
        if (showAnniversaries) parts.push('anniversaries');
        parts.push(MONTHS[month - 1].toLowerCase(), String(year));
        return parts.join('_');
    };

    const generatePdf = () => {
        const original = document.title;
        const restore = () => {
            document.title = original;
            window.removeEventListener('afterprint', restore);
        };
        window.addEventListener('afterprint', restore);
        document.title = pdfFileName();
        window.print();
    };

    /** The only way back to the defaults, and with them the only way to clear what is stored. */
    const reset = () => {
        setSettings(DEFAULTS);
        setNotice(null);
        quotaWarned.current = false;
        // The effect above clears the stored copy, since the settings now equal DEFAULTS.
    };

    const entryOf = (item) => {
        const meta = item.type === 'birthday'
            ? (settings.showAge && item.age ? `${item.age} years old` : null)
            : plural(item.years, 'year');

        return (
            <div className={`pdfd-entry is-${settings.dateStyle} is-${item.type}`} data-entry key={`${item.type}-${item.employee_id}-${item.day}`}>
                <span className="pdfd-entry-day">{dayLabel(item.day)}</span>
                <span className="pdfd-entry-name">{item.name}</span>
                {meta && <span className="pdfd-entry-meta">{meta}</span>}
            </div>
        );
    };

    const section = (kind, heading, items, interactive) => {
        const frame = frameOf(kind);
        const style = settings.boxStyles[kind];
        const free = settings.freeBoxes;

        return (
        <section
            className={`pdfd-section is-${kind} ${free ? 'is-free' : ''} ${free && interactive ? 'is-draggable' : ''}`}
            key={kind}
            style={free ? { left: `${frame.x}%`, top: `${frame.y}%`, width: `${frame.w}%`, ...heightStyle(frame) } : null}
            onPointerDown={free && interactive ? startDrag(kind, 'move') : undefined}
            onPointerMove={free && interactive ? onDragMove : undefined}
            onPointerUp={free && interactive ? endDrag : undefined}
        >
            {/* The tint is its own layer so its opacity cannot fade the names sitting on
                top of it, which is what setting opacity on the section itself would do. */}
            <div className="pdfd-section-bg" style={{ background: style.bg, opacity: style.opacity / 100 }} />
            {heading && (
                <h2 className="pdfd-section-title">
                    <span className="pdfd-section-icon">{kind === 'birthday' ? '🎂' : '🏆'}</span>
                    {fill(heading)}
                </h2>
            )}
            {items.length === 0 ? (
                <p className="pdfd-section-empty">
                    {kind === 'birthday' ? 'No birthdays this month.' : 'No work anniversaries this month.'}
                </p>
            ) : (
                <div className="pdfd-columns" style={{ gap: `${settings.columnGap}px` }}>
                    {columnsOf(kind, items).map((column, index) => (
                        <div className="pdfd-column" key={index}>
                            {column.map(entryOf)}
                        </div>
                    ))}
                </div>
            )}

            {free && interactive && GRIPS.map(edges => (
                <span
                    key={edges}
                    className={`pdfd-grip is-${edges}`}
                    onPointerDown={startDrag(kind, edges)}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                />
            ))}
        </section>
        );
    };

    const pageStyle = {
        width: `${page.width}in`,
        height: `${page.height}in`,
        fontFamily: font.stack,
        '--pdfd-font-size': `${settings.fontSize}px`,
        '--pdfd-line-spacing': settings.lineSpacing,
        '--pdfd-title-size': `${settings.titleSize}px`,
        '--pdfd-title-color': settings.titleColor,
        '--pdfd-subtitle-size': `${settings.subtitleSize}px`,
        '--pdfd-subtitle-color': settings.subtitleColor,
        '--pdfd-name-color': settings.nameColor,
        '--pdfd-name-weight': settings.nameBold ? 700 : 400,
        '--pdfd-heading-size': `${settings.headingSize}px`,
        '--pdfd-heading-color': settings.headingColor,
        '--pdfd-meta-color': settings.metaColor,
        '--pdfd-title-weight': settings.titleBold ? 800 : 400,
        '--pdfd-subtitle-weight': settings.subtitleBold ? 600 : 400,
        '--pdfd-heading-weight': settings.headingBold ? 800 : 400,
        '--pdfd-day-weight': settings.dayBold ? 800 : 400,
        ...(settings.dayColor ? { '--pdfd-day-color': settings.dayColor } : {})
    };

    const backgroundStyle = settings.background
        ? {
            backgroundImage: `url(${settings.background})`,
            backgroundSize: settings.backgroundFit === 'stretch' ? '100% 100%' : settings.backgroundFit,
            backgroundPosition: settings.backgroundPosition,
            backgroundRepeat: 'no-repeat',
            opacity: settings.backgroundOpacity / 100
        }
        : null;

    const sectionsFor = (interactive) => [
        showBirthdays ? section('birthday', settings.showBirthdayHeading ? settings.birthdayHeading : null, birthdays, interactive) : null,
        showAnniversaries ? section('anniversary', settings.showAnniversaryHeading ? settings.anniversaryHeading : null, anniversaries, interactive) : null
    ].filter(Boolean);

    // The printed sheet gets the same sections without the drag affordances.
    const previewSections = sectionsFor(true);
    const printSections = sectionsFor(false);

    /**
     * The floating editor's title and controls for one part of the page.
     *
     * The same settings the side panel writes, so the two can never disagree: the panel
     * is the full list, and this is the handful that belongs to what was double-clicked.
     */
    const editorFor = ({ part, kind }) => {
        const boldRow = (key, label = 'Bold') => (
            <div className="pdfd-row">
                <span>{label}</span>
                <ToggleButton label="Bold" pressed={settings[key]} onToggle={() => set(key, !settings[key])} />
            </div>
        );

        switch (part) {
            case 'date':
                return ['Date', (
                    <>
                        <div className="pdfd-row">
                            <span>Date style</span>
                            <div className="pdfd-segmented">
                                {DATE_STYLES.map(s => (
                                    <button key={s.id} className={settings.dateStyle === s.id ? 'is-on' : ''} onClick={() => set('dateStyle', s.id)}>
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <Row label="Date color">
                            <Color value={settings.dayColor ?? DEFAULT_DAY_COLOR} onChange={v => set('dayColor', v)} />
                        </Row>
                        {boldRow('dayBold', 'Date bold')}
                    </>
                )];

            case 'name':
                return ['Name', (
                    <>
                        <Slider label="Name size" value={settings.fontSize} min={10} max={28} step={1} onChange={v => set('fontSize', v)} format={v => `${v}px`} />
                        <Row label="Name color">
                            <Color value={settings.nameColor} onChange={v => set('nameColor', v)} />
                        </Row>
                        {boldRow('nameBold')}
                        <Slider label="Line spacing" value={settings.lineSpacing} min={1} max={3} step={0.1} onChange={v => set('lineSpacing', v)} format={v => `${v.toFixed(1)}×`} />
                    </>
                )];

            case 'meta':
                return ['Age / years', (
                    <>
                        <Row label="Color">
                            <Color value={settings.metaColor} onChange={v => set('metaColor', v)} />
                        </Row>
                        <Check label="Show age on birthdays" checked={settings.showAge} onChange={v => set('showAge', v)} />
                    </>
                )];

            case 'title':
            case 'subtitle': {
                const label = part === 'title' ? 'Title' : 'Subtitle';
                const showKey = part === 'title' ? 'showTitle' : 'showSubtitle';
                return [label, (
                    <>
                        <Row label="Text">
                            <input className="pdfd-input" value={settings[part]} onChange={e => set(part, e.target.value)} />
                            <VisibilityToggle visible={settings[showKey]} onToggle={() => set(showKey, !settings[showKey])} what={label} />
                            <InfoHint text={PLACEHOLDER_HELP} />
                        </Row>
                        <Slider label="Size" value={settings[`${part}Size`]} min={10} max={60} step={1} onChange={v => set(`${part}Size`, v)} format={v => `${v}px`} />
                        <Row label="Color">
                            <Color value={settings[`${part}Color`]} onChange={v => set(`${part}Color`, v)} />
                        </Row>
                        {boldRow(`${part}Bold`)}
                    </>
                )];
            }

            case 'heading': {
                const textKey = kind === 'birthday' ? 'birthdayHeading' : 'anniversaryHeading';
                const showKey = kind === 'birthday' ? 'showBirthdayHeading' : 'showAnniversaryHeading';
                const label = kind === 'birthday' ? 'Birthdays heading' : 'Anniversaries heading';
                return [label, (
                    <>
                        <Row label="Text">
                            <input className="pdfd-input" value={settings[textKey]} onChange={e => set(textKey, e.target.value)} />
                            <VisibilityToggle visible={settings[showKey]} onToggle={() => set(showKey, !settings[showKey])} what={label} />
                            <InfoHint text={PLACEHOLDER_HELP} />
                        </Row>
                        <Slider label="Size" value={settings.headingSize} min={10} max={60} step={1} onChange={v => set('headingSize', v)} format={v => `${v}px`} />
                        <Row label="Color">
                            <Color value={settings.headingColor} onChange={v => set('headingColor', v)} />
                        </Row>
                        {boldRow('headingBold')}
                        <p className="pdfd-hint">Size, color and weight apply to both headings.</p>
                    </>
                )];
            }

            case 'box':
                return [kind === 'birthday' ? 'Birthdays box' : 'Anniversaries box', (
                    <>
                        <Row label="Color">
                            <Color value={settings.boxStyles[kind].bg} onChange={v => setStyle(kind, 'bg', v)} />
                        </Row>
                        <Slider label="Opacity" value={settings.boxStyles[kind].opacity} min={0} max={100} step={5} onChange={v => setStyle(kind, 'opacity', v)} format={v => `${v}%`} />
                        <div className="pdfd-row">
                            <span>Columns</span>
                            <div className="pdfd-segmented">
                                <button className={settings.columns === null ? 'is-on' : ''} onClick={() => set('columns', null)}>Auto</button>
                                {[1, 2, 3, 4, 5, 6].map(n => (
                                    <button key={n} className={settings.columns === n ? 'is-on' : ''} onClick={() => set('columns', n)}>{n}</button>
                                ))}
                            </div>
                        </div>
                        <Slider label="Column spacing" value={settings.columnGap} min={8} max={80} step={2} onChange={v => set('columnGap', v)} format={v => `${v}px`} />
                        {/* Dragging the top, bottom or a corner fixes a height; this is the only way back to a
                            box that grows and shrinks with the month. */}
                        {frameOf(kind).h !== null && (
                            <button className="pdfd-btn is-block" onClick={() => setFrame(kind, 'h', null)}>
                                Back to auto height
                            </button>
                        )}
                        {settings.boxFrames[kind] && (
                            <button className="pdfd-btn is-block" onClick={() => setSettings(c => ({ ...c, boxFrames: { ...c.boxFrames, [kind]: null } }))}>
                                Re-arrange automatically
                            </button>
                        )}
                    </>
                )];

            default:
                return ['Page', (
                    <>
                        <Row label="Font">
                            <select className="pdfd-input" value={settings.fontId} onChange={e => set('fontId', e.target.value)}>
                                {FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                            </select>
                        </Row>
                        <div className="pdfd-row">
                            <span>Size</span>
                            <div className="pdfd-segmented">
                                {Object.entries(PAGE_SIZES).map(([id, size]) => (
                                    <button key={id} className={settings.pageSize === id ? 'is-on' : ''} onClick={() => set('pageSize', id)}>
                                        {size.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <Slider label="Vertical position" value={settings.verticalOffset} min={-120} max={200} step={4} onChange={v => set('verticalOffset', v)} format={v => `${v > 0 ? '+' : ''}${v}px`} />
                        <div className="pdfd-row">
                            <span>Background</span>
                            {/* Emptied after each pick so choosing the same file again still
                                fires onChange. */}
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                className="pdfd-file"
                                onChange={e => { onUpload(e); e.target.value = ''; }}
                            />
                        </div>
                        {settings.background && (
                            <>
                                <div className="pdfd-row">
                                    <span>Fit</span>
                                    <div className="pdfd-segmented">
                                        {BACKGROUND_FITS.map(f => (
                                            <button
                                                key={f.id}
                                                className={settings.backgroundFit === f.id ? 'is-on' : ''}
                                                onClick={() => set('backgroundFit', f.id)}
                                                title={f.hint}
                                            >
                                                {f.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="pdfd-row">
                                    <span>Position</span>
                                    <div className="pdfd-grid3">
                                        {BACKGROUND_POSITIONS.map(([value, glyph]) => (
                                            <button
                                                key={value}
                                                className={settings.backgroundPosition === value ? 'is-on' : ''}
                                                onClick={() => set('backgroundPosition', value)}
                                                title={value}
                                            >{glyph}</button>
                                        ))}
                                    </div>
                                </div>
                                <Slider label="Background opacity" value={settings.backgroundOpacity} min={5} max={100} step={5} onChange={v => set('backgroundOpacity', v)} format={v => `${v}%`} />
                                <button className="pdfd-btn is-block" onClick={() => set('background', null)}>
                                    Remove background
                                </button>
                                <p className="pdfd-hint">
                                    Enable "Background graphics" in the print dialog, or the page prints white.
                                </p>
                            </>
                        )}
                    </>
                )];
        }
    };

    const [editorTitle, editorBody] = editing ? editorFor(editing) : [null, null];

    return (
        <div className="pdfd-overlay" role="dialog" aria-label="Milestones PDF designer">
            {/* The @page rule has to name the chosen sheet, and it cannot come from an inline
                style, so it is injected as a real stylesheet. */}
            <style>{`@page { size: ${page.css} landscape; margin: 0; }`}</style>

            <header className="pdfd-topbar no-print">
                <div className="pdfd-topbar-title">
                    <strong>Design PDF</strong>
                    <span>
                        {MONTHS[month - 1]} {year} · {page.label} landscape ·{' '}
                        {plural(birthdays.length, 'birthday')} · {anniversaries.length} anniversar{anniversaries.length === 1 ? 'y' : 'ies'}
                    </span>
                </div>
                {/* What goes on the sheet, up here because it changes the whole page rather
                    than any one part of it -- nothing to double-click for it. */}
                <div className="pdfd-topbar-content">
                    <label className="pdfd-topbar-month">
                        <span>Month</span>
                        <select className="pdfd-input" value={month} onChange={e => onChangeMonth(Number(e.target.value))}>
                            {MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                        </select>
                    </label>
                    <div className="pdfd-segmented" role="radiogroup" aria-label="Content">
                        {[
                            ['birthdays', 'Birthdays'],
                            ['anniversaries', 'Work Anniversaries'],
                            ['both', 'Birthdays + Anniversaries']
                        ].map(([id, label]) => (
                            <button
                                key={id}
                                role="radio"
                                aria-checked={settings.content === id}
                                className={settings.content === id ? 'is-on' : ''}
                                onClick={() => set('content', id)}
                            >{label}</button>
                        ))}
                    </div>
                    <Check label="Show age on birthdays" checked={settings.showAge} onChange={v => set('showAge', v)} />
                </div>
                <div className="pdfd-topbar-actions">
                    <button className="pdfd-btn" onClick={reset}>Reset layout</button>
                    <button className="pdfd-btn is-primary" onClick={generatePdf}>Generate PDF</button>
                    <button className="pdfd-btn is-ghost" onClick={onClose}>Close</button>
                </div>
            </header>

            <div className="pdfd-body">
                <div className="pdfd-stage" ref={stageRef}>
                    {overflow > 0 && (
                        <div className="pdfd-warning no-print">
                            ⚠ {overflow} {overflow === 1 ? 'entry does' : 'entries do'} not fit — {overflow === 1 ? 'it is' : 'they are'} cut off the page, out of {overflow === 1 ? 'its' : 'their'} box, or trimmed mid-name.
                            Widen the box, use fewer columns, or reduce the name size or line spacing. Generating the PDF now would leave {overflow === 1 ? 'that person' : 'those people'} half-printed or absent.
                        </div>
                    )}
                    {notice && <div className="pdfd-notice no-print">{notice}</div>}
                    <p className="pdfd-stage-hint no-print">Double-click any part of the page to edit it.</p>

                    <div className="pdfd-scaler" ref={scalerRef} style={{ width: `${page.width * 96 * previewScale}px`, height: `${page.height * 96 * previewScale}px` }}>
                        <div
                            className="pdfd-scaled"
                            // The grips live inside the scaled sheet, so their thickness is
                            // divided by the scale to stay about 8px on screen at any size.
                            style={{ transform: `scale(${previewScale})`, '--pdfd-grip': `${8 / previewScale}px` }} onDoubleClick={onPreviewDoubleClick}>
                            <PdfPage
                                pageRef={pageRef}
                                bodyRef={bodyRef}
                                style={pageStyle}
                                backgroundStyle={backgroundStyle}
                                title={settings.showTitle ? fill(settings.title) : null}
                                subtitle={settings.showSubtitle ? fill(settings.subtitle) : null}
                                sections={previewSections}
                                free={settings.freeBoxes}
                                sectionGap={settings.sectionGap}
                                verticalOffset={settings.verticalOffset}
                                layout={settings.content === 'both' ? 'split' : 'single'}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Outside the scaled preview on purpose: a transformed ancestor would turn its
                position: fixed into "fixed to the page" and shrink it with the preview. */}
            {editing && (
                <FloatingEditor x={editing.x} y={editing.y} title={editorTitle} onClose={() => setEditing(null)}>
                    {editorBody}
                </FloatingEditor>
            )}

            {/* The sheet that prints, mounted straight onto <body>.
                Keeping it inside the app was what put a second, blank page in the PDF and
                shaved the right edge off the first: hiding the application with
                `visibility: hidden` leaves every one of its boxes in the flow, and the
                body's own 8px margin pushed an 11in-wide page 8px past an 11in-wide sheet.
                Out here the page has no ancestor to inherit a transform, an overflow or a
                margin from, so the page box and the paper are the same rectangle. It is the
                same component driven by the same settings as the preview, so the two cannot
                show different things. */}
            {createPortal(
                <div className="pdfd-print-portal">
                    <PdfPage
                        style={pageStyle}
                        backgroundStyle={backgroundStyle}
                        title={settings.showTitle ? fill(settings.title) : null}
                        subtitle={settings.showSubtitle ? fill(settings.subtitle) : null}
                        sections={printSections}
                        free={settings.freeBoxes}
                        sectionGap={settings.sectionGap}
                        verticalOffset={settings.verticalOffset}
                        layout={settings.content === 'both' ? 'split' : 'single'}
                    />
                </div>,
                document.body
            )}
        </div>
    );
};

/** The page itself — one component so the preview and the printed sheet cannot diverge. */
const PdfPage = ({ style, backgroundStyle, title, subtitle, sections, sectionGap, verticalOffset, layout, free, bodyRef, pageRef }) => (
    <div className="pdfd-page" style={style} ref={pageRef}>
        {backgroundStyle && <div className="pdfd-page-bg" style={backgroundStyle} />}
        <div className="pdfd-page-inner" ref={bodyRef} style={{ paddingTop: `${Math.max(0, 48 + verticalOffset)}px` }}>
            {title && <h1 className="pdfd-title">{title}</h1>}
            {subtitle && <p className="pdfd-subtitle">{subtitle}</p>}
            {!free && (
                <div className={`pdfd-sections is-${layout}`} style={{ gap: `${sectionGap}px` }}>
                    {sections}
                </div>
            )}
        </div>

        {/* Freely placed boxes sit in their own layer over the whole sheet, so their
            coordinates mean the page rather than whatever is left under the title. */}
        {free && <div className="pdfd-free-layer">{sections}</div>}
    </div>
);

/**
 * The mini editor that opens where the page was double-clicked.
 *
 * It opens beside the pointer and flips to the other side of it when it would run off the
 * window. Escape or a press anywhere outside it closes it; the native color picker lives
 * outside the DOM, so using it does not count as outside.
 */
const FloatingEditor = ({ x, y, title, onClose, children }) => {
    const ref = useRef(null);
    // Held in a ref so the listeners below are attached once rather than on every render.
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; }, [onClose]);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        const margin = 8;
        const offset = 12;

        let left = x + offset;
        if (left + width > window.innerWidth - margin) left = x - width - offset;
        let top = y + offset;
        if (top + height > window.innerHeight - margin) top = window.innerHeight - height - margin;

        // Written straight onto the element: this runs before the browser paints, so the
        // editor never shows at the unmeasured spot first.
        el.style.left = `${Math.max(margin, left)}px`;
        el.style.top = `${Math.max(margin, top)}px`;
    }, [x, y, title]);

    useEffect(() => {
        const onPointerDown = (event) => {
            if (!ref.current?.contains(event.target)) closeRef.current();
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape') closeRef.current();
        };
        // Capture phase: a box stops its own pointerdown from propagating so it can be
        // dragged, and the editor must still hear about it.
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, []);

    return (
        <div
            ref={ref}
            className="pdfd-floating no-print"
            role="dialog"
            aria-label={`${title} options`}
        >
            <div className="pdfd-floating-head">
                <strong>{title}</strong>
                <button type="button" className="pdfd-floating-close" onClick={onClose} aria-label="Close">×</button>
            </div>
            <div className="pdfd-floating-body">{children}</div>
        </div>
    );
};

// ── Small control primitives, local to this screen ──────────────────────────
const Row = ({ label, children }) => (
    <label className="pdfd-row">
        <span>{label}</span>
        {children}
    </label>
);

/**
 * The eye beside a text field: whether that piece of text reaches the sheet at all.
 *
 * A button rather than a checkbox, because it acts on the preview rather than collecting a
 * value, and the open/closed eye says which state it is in without a label.
 */
const VisibilityToggle = ({ visible, onToggle, what }) => (
    <button
        type="button"
        className={`pdfd-eye ${visible ? '' : 'is-off'}`}
        onClick={onToggle}
        aria-pressed={visible}
        title={visible ? `${what} is on the PDF — click to hide it` : `${what} is hidden from the PDF — click to show it`}
        aria-label={visible ? `Hide ${what} from the PDF` : `Show ${what} on the PDF`}
    >
        {visible ? <Eye size={15} /> : <EyeOff size={15} />}
    </button>
);

/**
 * The “i” beside a text field. Hover or keyboard focus reveals the note, which is why it
 * carries tabIndex: the placeholder list used to sit in the panel as a permanent paragraph,
 * and it was taking four lines to say something you only need once.
 */
const InfoHint = ({ text }) => (
    <span className="pdfd-info" tabIndex={0} aria-label={text}>
        i
        <span className="pdfd-tooltip" role="tooltip">{text}</span>
    </span>
);

/** A button that stays pressed, for a setting whose effect you can see on the page. */
const ToggleButton = ({ label, pressed, onToggle }) => (
    <button
        type="button"
        className={`pdfd-toggle-btn ${pressed ? 'is-on' : ''}`}
        aria-pressed={pressed}
        onClick={onToggle}
    >
        {label}
    </button>
);

const Check = ({ label, checked, onChange }) => (
    <label className="pdfd-check">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        {label}
    </label>
);

/**
 * Swatch plus hex, because a picker alone hides the value somebody matching a brand needs
 * to read off. The text field keeps its own draft: bound straight to the committed color
 * it would reset on the first keystroke, since "#1" is not a color yet.
 */
const Color = ({ value, onChange }) => {
    const [draft, setDraft] = useState(value);

    useEffect(() => { setDraft(value); }, [value]);

    return (
        <span className="pdfd-color">
            <input type="color" value={value} onChange={e => onChange(e.target.value)} />
            <input
                className="pdfd-input pdfd-color-hex"
                value={draft}
                maxLength={7}
                onChange={e => {
                    const next = e.target.value.trim();
                    setDraft(next);
                    if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next);
                }}
                onBlur={() => setDraft(value)}
            />
        </span>
    );
};

const Slider = ({ label, value, min, max, step, onChange, format }) => (
    <label className="pdfd-slider">
        <span>{label}<em>{format(value)}</em></span>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
);

export default MilestonesPdfDesigner;
