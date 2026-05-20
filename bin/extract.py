#!/usr/bin/env python3
"""
JC Advisory Health Webapp — data extraction pipeline.

Reads everything under ../data/ and regenerates:
  ../web/assets/data.js       — daily series the charts read at runtime
  ../web/assets/metrics.json   — every computed summary metric, keyed by name

Run from the project root:
    python3 bin/extract.py

When new files are dropped into data/, re-run this script and the charts +
metric values update on next page load (no other code changes needed for
quantitative sections).

Sources expected (drop new copies in place):
  data/Withings/weight.csv          Withings scale exports
  data/Withings/bp.csv              Withings BP cuff exports
  data/Oura/App Data/sleepmodel.csv  per-night staging (deep/rem/light/awake/HRV/RHR)
  data/Oura/App Data/dailysleep.csv  nightly sleep score
  data/Oura/App Data/dailyactivity.csv  steps + active calories
  data/Oura/App Data/dailyreadiness.csv readiness score
  data/Oura/App Data/dailyspo2.csv  SpO2 nightly average
  data/Oura/App Data/workout.csv    workouts (walking/cycling/strength/swim)
  data/Oura/App Data/enhancedtag.csv self-logged tags incl. alcohol/Valium
  data/Apple Health/electrocardiograms/*.csv  Apple Watch ECGs
"""

import csv
import datetime as dt
import json
import os
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WEB  = ROOT / "web" / "assets"

# ─── helpers ─────────────────────────────────────────────────────────────────

def parse_dt(s):
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            return dt.datetime.strptime(s, fmt)
        except ValueError:
            pass
    try:
        return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
    except ValueError:
        return None


def boxstats(values):
    """Tukey 1.5×IQR box: returns min/q1/median/q3/max within fences + outliers."""
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    q1  = statistics.quantiles(s, n=4)[0] if n >= 4 else s[0]
    med = statistics.median(s)
    q3  = statistics.quantiles(s, n=4)[2] if n >= 4 else s[-1]
    iqr = q3 - q1
    lo  = q1 - 1.5 * iqr
    hi  = q3 + 1.5 * iqr
    inside = [v for v in s if lo <= v <= hi]
    out    = [round(v, 3) for v in s if v < lo or v > hi]
    return {
        'n': n,
        'min':    round(min(inside), 3),
        'q1':     round(q1, 3),
        'median': round(med, 3),
        'q3':     round(q3, 3),
        'max':    round(max(inside), 3),
        'mean':   round(statistics.mean(s), 3),
        'items':  out,                # name 'items' matches chartjs-chart-boxplot API
    }


# ─── 1. Withings weight ──────────────────────────────────────────────────────

def extract_weight():
    path = DATA / "Withings" / "weight.csv"
    rows = []
    with path.open() as f:
        for r in csv.DictReader(f):
            try:
                d = dt.datetime.strptime(r['Date'], "%Y-%m-%d %H:%M:%S").date().isoformat()
            except (KeyError, ValueError):
                continue
            try:
                w  = float(r.get('Weight (kg)') or 0)
                fm = float(r.get('Fat mass (kg)') or 0)
                mm = float(r.get('Muscle mass (kg)') or 0)
            except ValueError:
                continue
            if w <= 0:
                continue
            bf = round(fm / w * 100, 2) if w else None
            # drop failed bio-impedance reads where bf% rounds to 0
            if bf is None or bf < 5:
                continue
            rows.append({'d': d, 'w': round(w, 2), 'bf': bf, 'mm': round(mm, 2)})
    rows.sort(key=lambda x: x['d'])

    series_recent = [r for r in rows if r['d'] >= '2025-10-01']
    latest        = rows[-1] if rows else None
    first_2026    = next((r for r in rows if r['d'] >= '2026-01-01'), None)

    deltas = None
    if latest and first_2026:
        deltas = {
            'w_kg':  round(latest['w']  - first_2026['w'],  2),
            'bf_pp': round(latest['bf'] - first_2026['bf'], 2),
            'mm_kg': round(latest['mm'] - first_2026['mm'], 2),
        }

    height_m = 1.74  # data/Withings/height.csv constant
    bmi = round(latest['w'] / (height_m ** 2), 2) if latest else None

    return {
        'series_recent': series_recent,
        'latest': latest,
        'deltas_since_2026_jan': deltas,
        'bmi': bmi,
        'n_total': len(rows),
        'range': [rows[0]['d'], rows[-1]['d']] if rows else None,
    }


# ─── 2. Oura sleep + HRV/RHR (per-night) ─────────────────────────────────────

def extract_sleep():
    path = DATA / "Oura" / "App Data" / "sleepmodel.csv"
    nights = []
    with path.open() as f:
        for row in csv.DictReader(f, delimiter=';'):
            if row.get('type') != 'long_sleep':
                continue
            try:
                total = int(row['total_sleep_duration'])
                if total < 3 * 3600:
                    continue
                nights.append({
                    'd':     row['day'],
                    'deep':  round(int(row['deep_sleep_duration']) / 3600, 3),
                    'rem':   round(int(row['rem_sleep_duration']) / 3600, 3),
                    'light': round(int(row['light_sleep_duration']) / 3600, 3),
                    'awake': round(int(row['awake_time']) / 3600, 3),
                    'total': round(total / 3600, 3),
                    'efficiency': float(row['efficiency']) if row.get('efficiency') else None,
                    'hrv': float(row['average_hrv']) if row.get('average_hrv') else None,
                    'rhr': float(row['lowest_heart_rate']) if row.get('lowest_heart_rate') else None,
                    'bedtime_start': row.get('bedtime_start'),
                })
            except (ValueError, KeyError):
                continue
    nights.sort(key=lambda x: x['d'])

    # box stats
    box = {stage: boxstats([n[stage] for n in nights]) for stage in
           ('deep', 'rem', 'light', 'awake', 'total')}

    # bedtime SD
    bedtime_h = []
    for n in nights:
        d = parse_dt(n['bedtime_start'])
        if not d:
            continue
        h = d.hour + d.minute / 60 + d.second / 3600
        if h < 12:
            h += 24
        bedtime_h.append(h)
    bedtime_sd = round(statistics.stdev(bedtime_h), 2) if len(bedtime_h) > 1 else None

    eff = [n['efficiency'] for n in nights if n['efficiency']]

    # HRV/RHR
    hrvs = [n['hrv'] for n in nights if n['hrv'] is not None]
    rhrs = [n['rhr'] for n in nights if n['rhr'] is not None]

    by_month_hrv = defaultdict(list)
    by_month_rhr = defaultdict(list)
    for n in nights:
        m = n['d'][:7]
        if n['hrv'] is not None:
            by_month_hrv[m].append(n['hrv'])
        if n['rhr'] is not None:
            by_month_rhr[m].append(n['rhr'])

    return {
        'n_nights':       len(nights),
        'range':          [nights[0]['d'], nights[-1]['d']] if nights else None,
        'box':            box,                                     # boxplot inputs
        'efficiency_median': round(statistics.median(eff), 1) if eff else None,
        'bedtime_sd_h':   bedtime_sd,
        'hrv_median':     round(statistics.median(hrvs), 1) if hrvs else None,
        'hrv_mean':       round(statistics.mean(hrvs), 1) if hrvs else None,
        'rhr_median':     round(statistics.median(rhrs), 1) if rhrs else None,
        'rhr_mean':       round(statistics.mean(rhrs), 1) if rhrs else None,
        'hrv_below20_pct':round(sum(1 for v in hrvs if v < 20) / len(hrvs) * 100) if hrvs else None,
        'hrv_above60_n':  sum(1 for v in hrvs if v >= 60),
        'hrv_by_month':   {m: round(statistics.mean(v), 1) for m, v in sorted(by_month_hrv.items())},
        'rhr_by_month':   {m: round(statistics.mean(v), 1) for m, v in sorted(by_month_rhr.items())},
        'series':         [{'d': n['d'], 'hrv': n['hrv'], 'rhr': n['rhr']} for n in nights if n['hrv'] is not None],
    }


def extract_sleep_score():
    path = DATA / "Oura" / "App Data" / "dailysleep.csv"
    scores = []
    with path.open() as f:
        for row in csv.DictReader(f, delimiter=';'):
            try:
                scores.append(int(row['score']))
            except (ValueError, KeyError):
                continue
    if not scores:
        return None
    qs = statistics.quantiles(scores, n=4)
    return {
        'n':      len(scores),
        'median': statistics.median(scores),
        'mean':   round(statistics.mean(scores), 1),
        'iqr':    [round(qs[0]), round(qs[2])],
    }


def extract_readiness():
    path = DATA / "Oura" / "App Data" / "dailyreadiness.csv"
    scores = []
    with path.open() as f:
        for row in csv.DictReader(f, delimiter=';'):
            try:
                scores.append(int(row['score']))
            except (ValueError, KeyError):
                continue
    if not scores:
        return None
    return {'n': len(scores), 'median': statistics.median(scores),
            'mean': round(statistics.mean(scores), 1)}


def extract_stress():
    """Daily stress + resilience from Oura.

    Reads two CSVs and joins by day:
      • dailystress.csv     — recovery_high, stress_high (seconds), day_summary
      • dailyresilience.csv — level (categorical) + contributors JSON
                              (daytime_recovery, sleep_recovery, stress, each 0-100)

    Daily resilience score = mean of the three contributors (0-100).
    Daily stress / recovery are returned in MINUTES so the chart axis stays
    in a human-readable range (0-560 min instead of 0-31500 s).
    """
    ds_path = DATA / "Oura" / "App Data" / "dailystress.csv"
    rs_path = DATA / "Oura" / "App Data" / "dailyresilience.csv"
    if not ds_path.exists() and not rs_path.exists():
        return None

    daily = {}  # day -> {stress_min, recovery_min, day_summary, level, score, ...}

    if ds_path.exists():
        with ds_path.open() as f:
            for row in csv.DictReader(f, delimiter=';'):
                day = (row.get('day') or '').strip()
                if not day:
                    continue
                try:
                    s_sec = int(row.get('stress_high') or 0)
                    r_sec = int(row.get('recovery_high') or 0)
                except ValueError:
                    s_sec = r_sec = 0
                summary = (row.get('day_summary') or '').strip() or None
                d = daily.setdefault(day, {})
                d['stress_min']   = round(s_sec / 60, 1)
                d['recovery_min'] = round(r_sec / 60, 1)
                d['day_summary']  = summary

    if rs_path.exists():
        with rs_path.open() as f:
            for row in csv.DictReader(f, delimiter=';'):
                day = (row.get('day') or '').strip()
                if not day:
                    continue
                level = (row.get('level') or '').strip() or None
                contrib_raw = row.get('contributors') or ''
                contrib = {}
                if contrib_raw:
                    try:
                        contrib = json.loads(contrib_raw)
                    except json.JSONDecodeError:
                        contrib = {}
                d = daily.setdefault(day, {})
                d['level']             = level
                d['daytime_recovery']  = contrib.get('daytime_recovery')
                d['sleep_recovery']    = contrib.get('sleep_recovery')
                d['stress_contrib']    = contrib.get('stress')
                vs = [v for v in (d.get('daytime_recovery'), d.get('sleep_recovery'),
                                  d.get('stress_contrib')) if isinstance(v, (int, float))]
                d['score'] = round(statistics.mean(vs), 1) if vs else None

    if not daily:
        return None

    series = []
    for day in sorted(daily.keys()):
        d = daily[day]
        series.append({
            'd':          day,
            'stress':     d.get('stress_min'),
            'recovery':   d.get('recovery_min'),
            'score':      d.get('score'),
            'level':      d.get('level'),
            'summary':    d.get('day_summary'),
        })

    stress_vals = [r['stress'] for r in series if isinstance(r['stress'], (int, float))]
    score_vals  = [r['score']  for r in series if isinstance(r['score'],  (int, float))]
    levels      = Counter(r['level']   for r in series if r['level'])
    summaries   = Counter(r['summary'] for r in series if r['summary'])

    peak = None
    if stress_vals:
        peak_row = max((r for r in series if isinstance(r['stress'], (int, float))),
                       key=lambda r: r['stress'])
        peak = {'d': peak_row['d'], 'stress_min': peak_row['stress']}

    return {
        'series':             series,
        'n_stress_days':      len(stress_vals),
        'n_resilience_days':  len(score_vals),
        'stress_median_min':  round(statistics.median(stress_vals), 1) if stress_vals else None,
        'stress_mean_min':    round(statistics.mean(stress_vals), 1)   if stress_vals else None,
        'stress_peak':        peak,
        'score_median':       round(statistics.median(score_vals), 1)  if score_vals  else None,
        'score_mean':         round(statistics.mean(score_vals), 1)    if score_vals  else None,
        'level_counts':       dict(levels),
        'summary_counts':     dict(summaries),
        'range':              [series[0]['d'], series[-1]['d']],
    }


def extract_glucose():
    """Glucose timeline — every 5-min reading from `data/glucose_timeline.csv`.

    Returns rows ready for the Plotly trace on the Vitals page:
        [["YYYY-MM-DD HH:MM", value_mg_dL], ...]
    Empty values (sensor gaps) are skipped.
    """
    path = DATA / "glucose_timeline.csv"
    if not path.exists():
        return None
    rows = []
    with path.open() as f:
        reader = csv.reader(f)
        next(reader, None)  # header
        for r in reader:
            if len(r) < 2:
                continue
            ts, v = r[0].strip(), r[1].strip()
            if not ts or not v:
                continue
            try:
                rows.append([ts, int(v)])
            except ValueError:
                try:
                    rows.append([ts, round(float(v))])
                except ValueError:
                    continue
    if not rows:
        return None
    rows.sort(key=lambda x: x[0])
    return {
        'rows':     rows,
        'n':        len(rows),
        'range':    [rows[0][0], rows[-1][0]],
    }


def extract_hr_by_tod():
    """Oura wrist HR binned by local-London time of day, 288 × 5-min slots.

    Honours UK DST: BST ends on the last Sunday of October at 01:00 UTC,
    BST begins on the last Sunday of March at 01:00 UTC. Returns per-slot
    [count, median_bpm, mean_bpm, sd_bpm].
    """
    path = DATA / "Oura" / "App Data" / "heartrate.csv"
    if not path.exists():
        return None

    BST_END_2025   = dt.datetime(2025, 10, 26, 1, 0, 0, tzinfo=dt.timezone.utc)
    BST_START_2026 = dt.datetime(2026,  3, 29, 1, 0, 0, tzinfo=dt.timezone.utc)

    N = 288
    slots = [[] for _ in range(N)]
    total = 0
    first_day = last_day = None

    with path.open() as f:
        next(f, None)  # header
        for line in f:
            line = line.rstrip('\n')
            if not line or line[0] == '#':
                continue
            parts = line.split(';', 2)
            if len(parts) < 2:
                continue
            ts_str = parts[0]
            try:
                bpm = int(parts[1])
            except ValueError:
                continue
            try:
                ts = dt.datetime.strptime(ts_str.replace('Z', '+00:00'),
                                          '%Y-%m-%dT%H:%M:%S.%f%z')
            except ValueError:
                try:
                    ts = dt.datetime.strptime(ts_str.replace('Z', '+00:00'),
                                              '%Y-%m-%dT%H:%M:%S%z')
                except ValueError:
                    continue

            if ts < BST_END_2025 or ts >= BST_START_2026:
                offset = dt.timedelta(hours=1)
            else:
                offset = dt.timedelta(0)
            local = ts.astimezone(dt.timezone.utc) + offset
            h, m = local.hour, local.minute
            k = (h * 60 + m) // 5
            if 0 <= k < N:
                slots[k].append(bpm)

            total += 1
            day = ts_str[:10]
            if first_day is None or day < first_day: first_day = day
            if last_day  is None or day > last_day:  last_day  = day

    out = []
    for a in slots:
        if not a:
            out.append([0, None, None, 0])
            continue
        me = statistics.mean(a)
        md = statistics.median(a)
        sd_ = statistics.pstdev(a) if len(a) > 1 else 0.0
        out.append([len(a), round(md), round(me, 2), round(sd_, 2)])

    return {
        'rows':       out,
        'n_total':    total,
        'range':      [first_day, last_day],
    }


def extract_bp_by_week():
    """Withings BP binned by ISO week (Mon-Sun) with median/mean/sd for
    systolic + diastolic. Returns per-week
        [weekStart, n, sysMed, sysMean, sysSd, diaMed, diaMean, diaSd]
    """
    path = DATA / "Withings" / "bp.csv"
    if not path.exists():
        return None

    def week_start(yyyy_mm_dd):
        y, m, d = (int(x) for x in yyyy_mm_dd.split('-'))
        dd = dt.date(y, m, d)
        return (dd - dt.timedelta(days=dd.weekday())).isoformat()

    buckets = defaultdict(lambda: {'sys': [], 'dia': []})
    total = 0
    first_day = last_day = None

    with path.open() as f:
        for r in csv.DictReader(f):
            try:
                ts  = r['Date']
                sys_ = float(r['Systolic'])
                dia  = float(r['Diastolic'])
            except (ValueError, KeyError, TypeError):
                continue
            day = ts[:10]
            wk  = week_start(day)
            buckets[wk]['sys'].append(sys_)
            buckets[wk]['dia'].append(dia)
            total += 1
            if first_day is None or day < first_day: first_day = day
            if last_day  is None or day > last_day:  last_day  = day

    rows = []
    for wk in sorted(buckets.keys()):
        sys_, dia = buckets[wk]['sys'], buckets[wk]['dia']
        sm, sM = statistics.mean(sys_), statistics.median(sys_)
        dm, dM = statistics.mean(dia),  statistics.median(dia)
        ss = statistics.pstdev(sys_) if len(sys_) > 1 else 0.0
        ds = statistics.pstdev(dia)  if len(dia)  > 1 else 0.0
        rows.append([
            wk, len(sys_),
            round(sM, 1), round(sm, 2), round(ss, 2),
            round(dM, 1), round(dm, 2), round(ds, 2),
        ])

    return {
        'rows':     rows,
        'n_weeks':  len(rows),
        'n_total':  total,
        'range':    [first_day, last_day],
    }


def extract_spo2():
    path = DATA / "Oura" / "App Data" / "dailyspo2.csv"
    vals = []
    with path.open() as f:
        for row in csv.DictReader(f, delimiter=';'):
            blob = row.get('spo2_percentage', '')
            try:
                d = json.loads(blob.replace("'", '"')) if blob else {}
                v = d.get('average')
                if v is not None:
                    vals.append(float(v))
            except (json.JSONDecodeError, ValueError):
                pass
    if not vals:
        return None
    return {'n': len(vals), 'median': round(statistics.median(vals), 1),
            'min': round(min(vals), 1)}


# ─── 3. Withings BP ──────────────────────────────────────────────────────────

def extract_bp():
    path = DATA / "Withings" / "bp.csv"
    rows = []
    grouped = defaultdict(list)
    with path.open() as f:
        for r in csv.DictReader(f):
            try:
                d = dt.datetime.strptime(r['Date'], "%Y-%m-%d %H:%M:%S").date().isoformat()
                sys_, dia, hr = int(r['Systolic']), int(r['Diastolic']), int(r['Heart rate'])
            except (ValueError, KeyError):
                continue
            rows.append({'d': d, 'sys': sys_, 'dia': dia, 'hr': hr})
            grouped[d].append((sys_, dia))
    rows.sort(key=lambda x: x['d'])
    daily = [{'d': d,
              'sys': round(statistics.mean(p[0] for p in lst), 1),
              'dia': round(statistics.mean(p[1] for p in lst), 1)}
             for d, lst in sorted(grouped.items()) if lst]

    by_month = defaultdict(list)
    for r in rows:
        by_month[r['d'][:7]].append(r)

    monthly = {}
    for m, vs in sorted(by_month.items()):
        monthly[m] = {
            'n':   len(vs),
            'sys': round(statistics.mean(v['sys'] for v in vs), 1),
            'dia': round(statistics.mean(v['dia'] for v in vs), 1),
        }

    classify = lambda s, d: ('Stage 2' if s >= 140 or d >= 90 else
                             'Stage 1' if s >= 130 or d >= 80 else
                             'Normal / Elevated')
    for m in monthly:
        monthly[m]['class'] = classify(monthly[m]['sys'], monthly[m]['dia'])

    return {
        'n_total':      len(rows),
        'range':        [rows[0]['d'], rows[-1]['d']] if rows else None,
        'sys_mean':     round(statistics.mean(r['sys'] for r in rows), 1) if rows else None,
        'dia_mean':     round(statistics.mean(r['dia'] for r in rows), 1) if rows else None,
        'sys_peak':     max(r['sys'] for r in rows) if rows else None,
        'dia_peak':     max(r['dia'] for r in rows) if rows else None,
        'cuff_hr_mean': round(statistics.mean(r['hr'] for r in rows), 1) if rows else None,
        'monthly':      monthly,
        'daily_series': daily,
        'latest_month': max(monthly) if monthly else None,
        'latest_month_means': monthly[max(monthly)] if monthly else None,
    }


# ─── 4. Activity / steps ─────────────────────────────────────────────────────

def extract_activity():
    path = DATA / "Oura" / "App Data" / "dailyactivity.csv"
    rows = []
    with path.open() as f:
        for row in csv.DictReader(f, delimiter=';'):
            try:
                rows.append({
                    'd':         row['day'],
                    'steps':     int(row['steps']),
                    'cal':       int(row['active_calories']),
                    'sedentary': int(row['sedentary_time']) / 60,         # minutes
                    'med_min':   int(row['medium_activity_time']) / 60,
                    'high_min':  int(row['high_activity_time']) / 60,
                })
            except (ValueError, KeyError):
                continue
    rows.sort(key=lambda x: x['d'])
    if not rows:
        return None

    steps  = [r['steps'] for r in rows if r['steps'] > 0]
    qs     = statistics.quantiles(steps, n=4)
    days_1 = sum(1 for s in steps if s >= 10000)
    days_7 = sum(1 for s in steps if s >= 7000)
    days_5 = sum(1 for s in steps if s >= 5000)
    z2_min = [r['med_min'] + r['high_min'] for r in rows]

    return {
        'n':              len(rows),
        'range':          [rows[0]['d'], rows[-1]['d']],
        'steps_median':   round(statistics.median(steps)),
        'steps_mean':     round(statistics.mean(steps)),
        'steps_iqr':      [round(qs[0]), round(qs[2])],
        'days_10k':       days_1,
        'days_7k':        days_7,
        'days_5k':        days_5,
        'days_total':     len(steps),
        'sed_h_mean':     round(statistics.mean(r['sedentary'] for r in rows) / 60, 2),
        'active_cal_mean':round(statistics.mean(r['cal'] for r in rows)),
        'zone2_min_per_day_mean': round(statistics.mean(z2_min), 1),
        'series':         [{'d': r['d'], 'steps': r['steps']} for r in rows],
    }


# ─── 5. Workouts ─────────────────────────────────────────────────────────────

def extract_workouts():
    path = DATA / "Oura" / "App Data" / "workout.csv"
    if not path.exists():
        return None
    rows = []
    with path.open() as f:
        for row in csv.DictReader(f, delimiter=';'):
            try:
                start = parse_dt(row['start_datetime'])
                end   = parse_dt(row['end_datetime'])
                if not start or not end:
                    continue
                rows.append({
                    'd':         row['day'],
                    'activity':  row['activity'],
                    'cal':       float(row['calories']) if row.get('calories') else 0.0,
                    'minutes':   round((end - start).total_seconds() / 60, 1),
                    'intensity': row['intensity'],
                })
            except (ValueError, KeyError):
                continue
    if not rows:
        return None
    by_act = defaultdict(lambda: {'n': 0, 'minutes': 0.0, 'cal': 0.0})
    for r in rows:
        by_act[r['activity']]['n']       += 1
        by_act[r['activity']]['minutes'] += r['minutes']
        by_act[r['activity']]['cal']     += r['cal']
    return {
        'n_total':     len(rows),
        'by_activity': {k: {**v, 'minutes': round(v['minutes']), 'cal': round(v['cal'])}
                         for k, v in by_act.items()},
        'by_intensity': dict(Counter(r['intensity'] for r in rows)),
    }


# ─── 6. Tags (alcohol / Valium) ──────────────────────────────────────────────

def extract_tags():
    path = DATA / "Oura" / "App Data" / "enhancedtag.csv"
    if not path.exists():
        return None
    counts  = Counter()
    alcohol = []
    valium  = []
    with path.open() as f:
        for row in csv.DictReader(f, delimiter=';'):
            custom = (row.get('custom_tag_name') or '').strip()
            ttype  = (row.get('tag_type_code') or '').strip()
            day    = row.get('start_day', '')
            key    = custom if custom else ttype
            counts[key] += 1
            kl = key.lower()
            if 'alcohol' in kl:
                alcohol.append(day)
            if 'valium' in kl or 'diaze' in kl:
                valium.append(day)
    return {
        'counts':              dict(counts),
        'alcohol_dates':       sorted(alcohol),
        'alcohol_n':           len(alcohol),
        'valium_dates':        sorted(valium),
        'valium_n':            len(valium),
        'most_recent_alcohol': max(alcohol) if alcohol else None,
        'most_recent_valium':  max(valium) if valium else None,
    }


# ─── 7. ECGs ─────────────────────────────────────────────────────────────────

def extract_ecgs():
    folder = DATA / "Apple Health" / "electrocardiograms"
    if not folder.exists():
        return None
    records = []
    for fp in sorted(folder.glob("*.csv")):
        meta = {}
        try:
            with fp.open() as f:
                for i, ln in enumerate(f):
                    if i > 30 or ',' not in ln:
                        if i > 30: break
                        continue
                    k, v = ln.split(',', 1)
                    k = k.strip()
                    v = v.strip()
                    if k.lower() in ('lead', 'sample rate', 'samples', 'version', 'µv'):
                        break
                    if k and v and not k[0].isdigit():
                        meta[k] = v
        except OSError:
            continue
        rec = meta.get('Recorded Date', '').strip('"')
        if not rec:
            continue
        records.append({
            'date': rec[:10],
            'class': meta.get('Classification', '').strip('"'),
            'avg_hr': meta.get('Average Heart Rate', '').replace('"', '').strip(),
            'symptoms': meta.get('Symptoms', '').strip('"'),
            'file': fp.name,
        })
    records.sort(key=lambda r: r['date'], reverse=True)
    by_class = Counter(r['class'] for r in records)

    # April 2026 cluster (recent quarter — rolling)
    recent_30 = [r for r in records if r['date'] >= '2026-03-26']
    recent_30_high = sum(1 for r in recent_30 if r['class'] == 'High Heart Rate')

    return {
        'n_total':        len(records),
        'by_class':       dict(by_class),
        'records':        records,
        'recent_30_n':    len(recent_30),
        'recent_30_high': recent_30_high,
    }


# ─── 8. Manual narrative CSVs (graceful — empty file = section stays narrative) ─

def read_csv_rows(name):
    """Read DATA/<name>.csv into a list of dicts. Returns [] if file missing or only header."""
    path = DATA / name
    if not path.exists():
        return []
    with path.open() as f:
        reader = csv.DictReader(f)
        return [row for row in reader if any((v or '').strip() for v in row.values())]


def extract_medications():
    rows = read_csv_rows("medications.csv")
    return rows or None


def extract_supplements():
    rows = read_csv_rows("supplements.csv")
    return rows or None


def extract_injuries():
    rows = read_csv_rows("injuries.csv")
    return sorted(rows, key=lambda r: r.get('date', '')) if rows else None


def extract_surgeries():
    rows = read_csv_rows("surgeries.csv")
    return sorted(rows, key=lambda r: r.get('date', '')) if rows else None


def extract_audit():
    rows = read_csv_rows("audit.csv")
    if not rows:
        return None
    by_date = defaultdict(list)
    for r in rows:
        by_date[r.get('date', '')].append(r)
    latest = max(by_date) if by_date else None
    if not latest:
        return None
    items = sorted(by_date[latest], key=lambda r: r.get('q', ''))
    total = sum(int(r['score']) for r in items if (r.get('score') or '').isdigit())
    max_total = sum(int(r['max']) for r in items if (r.get('max') or '').isdigit())
    return {'date': latest, 'items': items, 'total': total, 'max': max_total,
            'classification': ('Probable dependence' if total >= 20 else
                                'High risk'         if total >= 16 else
                                'Harmful'           if total >=  8 else
                                'Low risk')}


def extract_gut():
    rows = read_csv_rows("gut_microbiota.csv")
    if not rows:
        return None
    by_date = defaultdict(list)
    for r in rows:
        by_date[r.get('date', '')].append(r)
    latest = max(by_date) if by_date else None
    if not latest:
        return None
    return {'date': latest, 'items': by_date[latest]}


def extract_clinical_history():
    rows = read_csv_rows("clinical_history.csv")
    if not rows:
        return None
    grouped = defaultdict(list)
    for r in rows:
        grouped[r.get('category', '').strip().lower()].append({
            'heading': r.get('heading', '').strip(),
            'detail':  r.get('detail',  '').strip(),
        })
    return dict(grouped) or None


def extract_alcohol_pattern():
    rows = read_csv_rows("alcohol_pattern.csv")
    return rows or None


def extract_mental_timeline():
    rows = read_csv_rows("mental_timeline.csv")
    return sorted(rows, key=lambda r: r.get('date', '')) if rows else None


def extract_risk_assessment():
    rows = read_csv_rows("risk_assessment.csv")
    return rows or None


# ─── compose ─────────────────────────────────────────────────────────────────

def js_array(rows, keys):
    """Render a list of dicts as a compact JS array literal."""
    out = []
    for r in rows:
        vals = []
        for k in keys:
            v = r.get(k)
            if isinstance(v, str):
                vals.append(json.dumps(v))
            elif v is None:
                vals.append('null')
            elif isinstance(v, float):
                vals.append(f"{v:.2f}".rstrip('0').rstrip('.'))
            else:
                vals.append(str(v))
        out.append('[' + ','.join(vals) + ']')
    return '[' + ','.join(out) + ']'


def main():
    print(f"Reading from: {DATA}")
    weight    = extract_weight()
    sleep     = extract_sleep()
    score     = extract_sleep_score()
    readiness = extract_readiness()
    spo2      = extract_spo2()
    stress    = extract_stress()
    bp        = extract_bp()
    glucose   = extract_glucose()
    hr_tod    = extract_hr_by_tod()
    bp_weekly = extract_bp_by_week()
    activity  = extract_activity()
    workouts  = extract_workouts()
    tags      = extract_tags()
    ecgs      = extract_ecgs()

    # Manual / narrative CSVs (graceful — None until you fill them in)
    medications      = extract_medications()
    supplements      = extract_supplements()
    injuries         = extract_injuries()
    surgeries        = extract_surgeries()
    audit            = extract_audit()
    gut              = extract_gut()
    clinical_history = extract_clinical_history()
    alcohol_pattern  = extract_alcohol_pattern()
    mental_timeline  = extract_mental_timeline()
    risk_assessment  = extract_risk_assessment()

    today = dt.date.today().isoformat()

    metrics = {
        'generated_at': today,
        'weight':       weight,
        'sleep':        sleep,
        'sleep_score':  score,
        'readiness':    readiness,
        'spo2':         spo2,
        'stress':       stress,
        'bp':           bp,
        'activity':     activity,
        'workouts':     workouts,
        'tags':         tags,
        'ecgs':         ecgs,
        # Manual sources
        'medications':       medications,
        'supplements':       supplements,
        'injuries':          injuries,
        'surgeries':         surgeries,
        'audit':             audit,
        'gut_microbiota':    gut,
        'clinical_history':  clinical_history,
        'alcohol_pattern':   alcohol_pattern,
        'mental_timeline':   mental_timeline,
        'risk_assessment':   risk_assessment,
    }

    metrics_path = WEB / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, default=str, indent=2))
    print(f"Wrote {metrics_path}  ({metrics_path.stat().st_size:,} bytes)")

    # data.js — compact daily series for the chart code
    blocks = [f"/* Real-data series — generated {today} from /data */"]
    blocks.append(f"const WEIGHT  = {js_array(weight['series_recent'], ['d', 'w', 'bf', 'mm'])};")
    blocks.append(f"const HRV_RHR = {js_array(sleep['series'], ['d', 'hrv', 'rhr'])};")
    blocks.append(f"const STEPS   = {js_array(activity['series'], ['d', 'steps'])};")
    blocks.append(f"const BP      = {js_array(bp['daily_series'], ['d', 'sys', 'dia'])};")
    blocks.append(f"const ECG     = {js_array(ecgs['records'], ['date', 'class', 'file'])};")
    if stress and stress.get('series'):
        blocks.append(
            "const STRESS_RES = "
            + js_array(stress['series'], ['d', 'stress', 'recovery', 'score', 'level', 'summary'])
            + ";"
        )
    else:
        blocks.append("const STRESS_RES = [];")

    # ── GLUCOSE — every 5-min reading from glucose_timeline.csv ──────────────
    if glucose and glucose.get('rows'):
        body = ','.join(f'[{json.dumps(t)},{v}]' for t, v in glucose['rows'])
        blocks.append(f"/* GLUCOSE — {glucose['n']} readings · "
                      f"{glucose['range'][0]} → {glucose['range'][1]} */")
        blocks.append(f"const GLUCOSE = [{body}];")
    else:
        blocks.append("const GLUCOSE = [];")

    # ── HR_BY_TOD — Oura heart-rate binned by local time of day (288 × 5 min) ─
    if hr_tod and hr_tod.get('rows'):
        def _fmt(row):
            n, md, m, s = row
            return f"[{n},{md if md is not None else 'null'},{m if m is not None else 'null'},{s}]"
        body = ','.join(_fmt(r) for r in hr_tod['rows'])
        blocks.append(f"/* HR_BY_TOD — Oura wrist HR, binned by local-London "
                      f"time of day. Source: data/Oura/App Data/heartrate.csv · "
                      f"{hr_tod['range'][0]} → {hr_tod['range'][1]} · "
                      f"{hr_tod['n_total']:,} readings · row: [count, median_bpm, mean_bpm, sd_bpm] */")
        blocks.append(f"const HR_BY_TOD = [{body}];")
    else:
        blocks.append("const HR_BY_TOD = [];")

    # ── BP_BY_WEEK — Withings BP binned by ISO week ──────────────────────────
    if bp_weekly and bp_weekly.get('rows'):
        def _fmt(r):
            wk, n, sM, sm, ss, dM, dm, ds = r
            return f'["{wk}",{n},{sM},{sm},{ss},{dM},{dm},{ds}]'
        body = ','.join(_fmt(r) for r in bp_weekly['rows'])
        blocks.append(f"/* BP_BY_WEEK — Withings BP by ISO week (Mon-Sun). "
                      f"{bp_weekly['range'][0]} → {bp_weekly['range'][1]} · "
                      f"{bp_weekly['n_weeks']} weeks · {bp_weekly['n_total']} readings · "
                      f"row: [weekStart, n, sysMed, sysMean, sysSd, diaMed, diaMean, diaSd] */")
        blocks.append(f"const BP_BY_WEEK = [{body}];")
    else:
        blocks.append("const BP_BY_WEEK = [];")
    # Sleep boxplot input (object literal)
    box = sleep['box']
    blocks.append('const SLEEP_BOX = ' + json.dumps({
        k: {'min': v['min'], 'q1': v['q1'], 'median': v['median'], 'q3': v['q3'],
            'max': v['max'], 'mean': v['mean'], 'items': v['items'], 'n': v['n']}
        for k, v in box.items()
    }) + ';')

    data_path = WEB / "data.js"
    data_path.write_text('\n'.join(blocks) + '\n')
    print(f"Wrote {data_path}    ({data_path.stat().st_size:,} bytes)")

    # Summary print
    print()
    print("─── Summary ───")
    print(f"Weight:    {weight['n_total']} readings · latest {weight['latest']['d']} = {weight['latest']['w']}kg ({weight['latest']['bf']}%)")
    print(f"Sleep:     {sleep['n_nights']} nights {sleep['range'][0]} → {sleep['range'][1]}")
    print(f"           median total {sleep['box']['total']['median']:.2f}h, deep {sleep['box']['deep']['median']:.2f}h, REM {sleep['box']['rem']['median']:.2f}h")
    print(f"           HRV median {sleep['hrv_median']}ms, RHR median {sleep['rhr_median']}bpm")
    print(f"Steps:     median {activity['steps_median']}, days≥10k = {activity['days_10k']}")
    print(f"BP:        {bp['n_total']} readings, mean {bp['sys_mean']}/{bp['dia_mean']}, peak {bp['sys_peak']}/{bp['dia_peak']}")
    print(f"           latest month ({bp['latest_month']}): {bp['latest_month_means']['sys']}/{bp['latest_month_means']['dia']} ({bp['latest_month_means']['class']})")
    print(f"Workouts:  {workouts['n_total']} sessions")
    print(f"ECGs:      {ecgs['n_total']} ({ecgs['by_class']})")
    print(f"Tags:      alcohol {tags['alcohol_n']}, valium {tags['valium_n']}")
    if stress:
        peak = stress.get('stress_peak') or {}
        print(f"Stress:    {stress['n_stress_days']} days · median {stress['stress_median_min']} min/day · "
              f"peak {peak.get('stress_min', '?')} min on {peak.get('d', '?')}")
        print(f"Resilience:{stress['n_resilience_days']} days · median score {stress['score_median']} · "
              f"levels {stress['level_counts']}")
    if glucose:
        print(f"Glucose:   {glucose['n']} readings · {glucose['range'][0]} → {glucose['range'][1]}")
    if hr_tod:
        print(f"HR-by-TOD: {hr_tod['n_total']:,} readings · {hr_tod['range'][0]} → {hr_tod['range'][1]}")
    if bp_weekly:
        print(f"BP-weekly: {bp_weekly['n_weeks']} weeks · {bp_weekly['n_total']} readings · "
              f"{bp_weekly['range'][0]} → {bp_weekly['range'][1]}")

    print()
    print("─── Manual sources ───")
    def status(name, val, count_fn=lambda v: len(v) if isinstance(v, (list, dict)) else 1):
        if val is None:
            print(f"  {name:18s}  empty (template only) — section stays narrative")
        else:
            print(f"  {name:18s}  {count_fn(val)} rows / loaded ✓")
    status('medications',      medications)
    status('supplements',      supplements)
    status('injuries',         injuries)
    status('surgeries',        surgeries)
    status('audit',            audit, lambda v: f"{v['total']}/{v['max']} ({len(v['items'])} questions)")
    status('gut_microbiota',   gut,   lambda v: f"{len(v['items'])} markers ({v['date']})")
    status('clinical_history', clinical_history, lambda v: f"{sum(len(b) for b in v.values())} bullets across {len(v)} categories")
    status('alcohol_pattern',  alcohol_pattern)
    status('mental_timeline',  mental_timeline)
    status('risk_assessment',  risk_assessment)
    return 0


if __name__ == '__main__':
    sys.exit(main())
