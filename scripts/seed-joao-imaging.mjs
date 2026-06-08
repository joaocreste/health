const BASE=process.env.LUMEN_BASE||"https://lumenhealth.io",ADMIN="pending:admin",CLERK="pending:joao";
const rows=[
 {modality:"MRI",body_part:"cervical_spine",study_date:"2026-03-26",source_format:"MIXED",file_count:74,
  notes:"MRI cervical spine (Dr. Mohsen Alkmeshi; ref. Dr. Muhammad Najim). Mid-cervical degenerative change with shallow disc-osteophyte complexes C3/4–C6/7, mild canal narrowing and mild cord indentation without cord signal abnormality. Right>left uncovertebral hypertrophy C5/6–C6/7 with bilateral foraminal narrowing encroaching the exiting right C6 and C7 nerve roots. Correlate for right-sided radiculopathy."},
 {modality:"CT",body_part:"facial_sinuses",study_date:"2026-01-12",source_format:"MIXED",file_count:707,
  notes:"CT facial sinuses (Dr. Jose Roberto Chodraui) after bicycle facial trauma (5 Jan 2026). Right frontal soft-tissue findings consistent with recent trauma, bone preserved. Left sphenoid + bilateral maxillary sinusopathy (chronic-pattern)."},
 {modality:"CT",body_part:"brain",study_date:"2026-01-03",source_format:"MIXED",
  report_blob_key:"scans/ct-brain-2026-01-03-report.pdf",
  notes:"Emergency non-contrast brain CT, Hopital Bichat-Claude Bernard (AP-HP Nord, Paris); reported Dr. Ahmed Tibaoui, validated 03 Jan 2026 23:11, service head Prof. Antoine Khalil. Acute scan the night of the bicycle accident (fall, head trauma). Right frontal subdural haematoma (1.5 mm max), minimal right frontal traumatic subarachnoid haemorrhage with sub-centimetre haemorrhagic contusions; ventricles, midline and basal cisterns normal - no mass effect or shift. Complex right fronto-orbital fracture (extending to the right orbital roof) + right maxillo-zygomatic disjunction fracture (to the lateral wall of the right maxillary sinus), right hemosinus and right orbital emphysema. Report-only record (no image series). Report PDF: ct-brain-2026-01-03-report.pdf."},
 {modality:"US",body_part:"left_frontal_soft_tissue",study_date:"2023-03-16",source_format:"MIXED",file_count:303,
  notes:"US-guided core-needle biopsy, left frontal soft-tissue thickening (Dr. Rodrigo Gobbo Garcia). 3 fragments; no complications. Histopathology (Albert Einstein AE23-016535, signed 17 Mar 2023): cicatricial dermal fibrosis, no atypia, no malignancy."},
 {modality:"MRI",body_part:"lumbar_spine",study_date:"2024-10-29",source_format:"MIXED",file_count:160,
  notes:"MRI lumbar spine (Dr. Almir A. L. Urbanetz; ordered Dr. Fausto Santana Celestino, Hospital Vila Nova Star). Degenerative discopathy L5-S1 with median + left-paramedian disc protrusion, annular fissure, dural impression, tenuous contact with the descending left S1 nerve root."},
 {modality:"CT",body_part:"lumbosacral_spine",study_date:"2024-10-29",source_format:"MIXED",file_count:1369,
  notes:"CT lumbar/sacral spine, same-day pair (Dr. Marco de Andrade Bianchi). Complete transverse fracture of the first coccygeal vertebral body with 0.2 cm anterior displacement and soft-tissue oedema. L4-L5/L5-S1 asymmetric left paramedian/foraminal disc bulges."},
 {modality:"CT",body_part:"heart_coronary",study_date:"2023-07-19",source_format:"MIXED",file_count:2206,
  notes:"Coronary CT angiography (Dr. Marcos R. G. de Queiroz, Albert Einstein). Calcium score (Agatston) 7 — LAD 7, others 0 — 75th–90th percentile for age/sex. Partially calcified plaque with positive remodelling in the proximal LAD producing slight luminal reduction; no significant stenosis. Uncommon finding for this age group."},
 {modality:"EEG",body_part:"brain",study_date:"2023-03-29",source_format:"MIXED",file_count:16,
  notes:"Digital EEG, waking/drowsy/sleep with hyperventilation + photostimulation (Dra. Taissa Ferrari Marinho). Background asymmetric — organised on the right, slightly disorganised on the left; wakeful posterior rhythm 9–10 Hz."},
];
const resp=await fetch(`${BASE}/api/admin/seed-clinical`,{method:"POST",headers:{"Content-Type":"application/json","X-Viewer-Clerk":ADMIN},body:JSON.stringify({patient_clerk:CLERK,table:"imaging_studies",rows})});
console.log(resp.status,await resp.text());
