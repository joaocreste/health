/* Lumen Health — Paulo Silotto Souza lab history
 *
 * Structured from 30 scanned lab PDFs (2011-2026) in
 * Patients/Paulo Silotto/New Exams. Most source PDFs are stored in R2 (eu)
 * under lab/<clerk>/ and streamed via the labs-scoped /api/lab-source route;
 * each document card links to its original. Two sources (o29 Pasteur sodium,
 * o30 Unimed emergency panel) are ingested without an archived original, so
 * their analytes render but they carry no document card — see NOCARD.
 *
 * Values were transcribed per-PDF, then reconciled into canonical markers and
 * deduplicated to one point per analyte per collection date (.staging/paulo-labs).
 * Rare all-zero differential lines (myelocytes, blasts, etc.) are kept in the DB
 * mirror but omitted here to keep the UI signal-dense.
 */
window.PAULO_LABS = {
  "patient": {
    "full_name": "Paulo Augusto Silotto Dias de Souza",
    "dob": "1961-07-14",
    "sex": "male",
    "country": "BR",
    "native_language": "pt",
    "clerk": "pending:paulo-silotto-df3441"
  },
  "documents": [
    {
      "date": "2026-04-16",
      "laboratory": "Pasteur Laboratório",
      "doctor": "",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2026-04-16-tipagem-sanguinea-abo-rh-pasteur.pdf",
      "title_en": "ABO/Rh blood typing",
      "title_pt": "Tipagem sanguínea ABO/Rh",
      "src": "o28"
    },
    {
      "date": "2025-11-12",
      "laboratory": "Pasteur Laboratório",
      "doctor": "Antônio Carlos Silva Maychak",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2025-11-12-painel-completo-bioquimica-urina-pasteur.pdf",
      "title_en": "CBC + glucose + lipids + vitamin D + B12 + PSA + urine",
      "title_pt": "Hemograma + glicemia + lipídico + vitamina D + B12 + PSA + urina",
      "src": "o27"
    },
    {
      "date": "2024-04-15",
      "laboratory": "Biolabor Laboratório",
      "doctor": "Dra. Sirlei Conceição M. Vono (CRBO 40703/01-D)",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2024-04-15-hemograma-sorologias-dengue-covid-biolabor.pdf",
      "title_en": "CBC + dengue NS1 + COVID-19 antigen",
      "title_pt": "Hemograma + dengue NS1 + antígeno COVID-19",
      "src": "o11"
    },
    {
      "date": "2024-04-13",
      "laboratory": "Laboratório Behring",
      "doctor": "Lidia A. Costa Barreira (CRBM 2052)",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2024-04-13-hemograma-completo-behring-2024.pdf",
      "title_en": "Complete blood count",
      "title_pt": "Hemograma completo",
      "src": "o14"
    },
    {
      "date": "2023-02-24",
      "laboratory": "Biolabor Laboratório",
      "doctor": "Antonio Carlos Silva Maychak",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2023-02-24-glicemia-hba1c-colesterol-biolabor.pdf",
      "title_en": "Glucose, HbA1c, cholesterol",
      "title_pt": "Glicemia, HbA1c, colesterol",
      "src": "o07"
    },
    {
      "date": "2023-02-24",
      "laboratory": "Biolabor Laboratório",
      "doctor": "Antônio Carlos Silva Maychak",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2023-02-24-sangue-urina-biolabor-a.pdf",
      "title_en": "Biochemistry + PSA + testosterone + insulin + urine",
      "title_pt": "Bioquímica + PSA + testosterona + insulina + urina",
      "src": "o04"
    },
    {
      "date": "2023-02-24",
      "laboratory": "Biolabor Laboratório",
      "doctor": "Antônio Carlos Silva Maychak",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2023-02-24-sangue-urina-biolabor-b.pdf",
      "title_en": "Glycemic, lipid, renal, PSA, testosterone, insulin + urine",
      "title_pt": "Glicêmico, lipídico, renal, PSA, testosterona, insulina + urina",
      "src": "o03"
    },
    {
      "date": "2022-09-22",
      "laboratory": "Pasteur Laboratório",
      "doctor": "Maurício de Almeida Pereira",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2022-09-22-painel-bioquimica-tireoide-vitd-pasteur.pdf",
      "title_en": "Biochemistry + thyroid + vitamin D",
      "title_pt": "Bioquímica + tireoide + vitamina D",
      "src": "o18"
    },
    {
      "date": "2022-08-12",
      "laboratory": "Biolabor Laboratório",
      "doctor": "Fabio Augusto dos Santos Watanabe",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2022-08-12-glicemia-lipidico-hormonios-biolabor.pdf",
      "title_en": "Glucose, HbA1c, lipids, hormones",
      "title_pt": "Glicemia, HbA1c, lipídico, hormônios",
      "src": "o08"
    },
    {
      "date": "2022-04-01",
      "laboratory": "UNICOO Laboratório",
      "doctor": "Fabio Augusto dos Santos Watanabe",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2022-04-01-lipidico-glicemico-hormonal-unicoo.pdf",
      "title_en": "Lipid + glycemic + hormonal profile",
      "title_pt": "Perfil lipídico + glicêmico + hormonal",
      "src": "o05"
    },
    {
      "date": "2022-03-11",
      "laboratory": "Pasteur Laboratório",
      "doctor": "Fábio Augusto dos Santos Watanabe",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2022-03-11-painel-laboratorial-completo-pasteur.pdf",
      "title_en": "Full panel + hormones + urine + urine culture",
      "title_pt": "Painel completo + hormônios + urina + urocultura",
      "src": "o19"
    },
    {
      "date": "2019-03-05",
      "laboratory": "Padrão Ribeirão – Medicina Diagnóstica",
      "doctor": "Cláudia Leiga R. da Cunha",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2019-03-05-hemograma-marcadores-cardiacos-padrao.pdf",
      "title_en": "CBC + cardiac markers (CK-MB, troponin, CRP)",
      "title_pt": "Hemograma + marcadores cardíacos (CK-MB, troponina, PCR)",
      "src": "o15"
    },
    {
      "date": "2019-02-08",
      "laboratory": "BIOLABOR Laboratório (Controllab)",
      "doctor": "Dr. Fábio Rabelo",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2019-02-08-painel-hba1c-hemograma-vhs-pcr-biolabor.pdf",
      "title_en": "HbA1c + CBC + ESR + CRP + glucose",
      "title_pt": "HbA1c + hemograma + VHS + PCR + glicemia",
      "src": "o22"
    },
    {
      "date": "2019-01-28",
      "laboratory": "Biolabor Laboratório (Controllab)",
      "doctor": "Dra. Sirlei C. Margato Vono (CRBM 6078/491-D)",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2019-01-28-hemograma-biolabor-2019-01.pdf",
      "title_en": "Complete blood count (two draws, 25 & 28 Jan)",
      "title_pt": "Hemograma completo (duas coletas, 25 e 28 jan)",
      "src": "o13"
    },
    {
      "date": "2018-10-16",
      "laboratory": "LABCLIN – Análise Diagnóstica",
      "doctor": "Dr. Wanelgil de Jesus Colla",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2018-10-16-urina-tipo-1-eas-labclin.pdf",
      "title_en": "Urinalysis (type I / EAS)",
      "title_pt": "Urina tipo I (EAS)",
      "src": "o26"
    },
    {
      "date": "2018-10-16",
      "laboratory": "LABCLIN / Laboratório Sta Bárbara",
      "doctor": "Dr. Wanelgil de Jesus Colla",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2018-10-16-hemograma-labclin-2018-10.pdf",
      "title_en": "Complete blood count",
      "title_pt": "Hemograma completo",
      "src": "o12"
    },
    {
      "date": "2018-08-16",
      "laboratory": "LABCASTELO",
      "doctor": "Mauricio Guimaraes (CRBM 0024100)",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2018-08-16-painel-sanguineo-completo-labcastelo-a.pdf",
      "title_en": "Full blood panel (biochemistry + lipids + hormones)",
      "title_pt": "Painel sanguíneo completo (bioquímica + lipídico + hormônios)",
      "src": "o24"
    },
    {
      "date": "2018-08-16",
      "laboratory": "LABCASTELO",
      "doctor": "Mauricio Guimaraes (CRBM 0024100)",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2018-08-16-painel-hemograma-bioquimica-labcastelo-b.pdf",
      "title_en": "CBC + biochemistry + coagulation",
      "title_pt": "Hemograma + bioquímica + coagulograma",
      "src": "o23"
    },
    {
      "date": "2018-08-16",
      "laboratory": "Laboratório Hermes Pardini",
      "doctor": "Marlene Schwarz",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2018-08-16-hemograma-bioquimica-pardini.pdf",
      "title_en": "CBC + biochemistry (lipids, renal, TSH, ferritin, PSA)",
      "title_pt": "Hemograma + bioquímica (lipídico, renal, TSH, ferritina, PSA)",
      "src": "o09"
    },
    {
      "date": "2017-02-03",
      "laboratory": "LABCLIN – Laboratório Sta Bárbara",
      "doctor": "Dra. Marina Politti (CRBM 0816852)",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2017-02-03-glicemia-jejum-pos-prandial-labclin.pdf",
      "title_en": "Fasting & post-prandial glucose",
      "title_pt": "Glicemia de jejum e pós-prandial",
      "src": "o06"
    },
    {
      "date": "2017-01-28",
      "laboratory": "Instituto de Complementação Diagnóstica",
      "doctor": "Dr. Fernando Jorge Vallada Roselino",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2017-01-28-painel-sangue-bioquimica-icd-a.pdf",
      "title_en": "Blood panel — biochemistry",
      "title_pt": "Painel de sangue — bioquímica",
      "src": "o17"
    },
    {
      "date": "2017-01-28",
      "laboratory": "Instituto de Complementação Diagnóstica",
      "doctor": "Dr. Fernando Jorge Vallada Roselino",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2017-01-28-painel-sangue-bioquimica-icd-b.pdf",
      "title_en": "Blood panel — biochemistry + CBC",
      "title_pt": "Painel de sangue — bioquímica + hemograma",
      "src": "o16"
    },
    {
      "date": "2017-01-28",
      "laboratory": "Instituto de Complementação Diagnóstica",
      "doctor": "Dr. Fernando Jorge Vallada Roselino",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2017-01-28-bundle-bioquimica-hemograma-icd.pdf",
      "title_en": "Blood panel (biochemistry + CBC + glucose + urine)",
      "title_pt": "Painel de sangue (bioquímica + hemograma + glicemia + urina)",
      "src": "o02"
    },
    {
      "date": "2017-01-26",
      "laboratory": "ICD – Instituto de Complementação Diagnóstica",
      "doctor": "Dr. Fernando Jorge Vallada Roselino",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2017-01-26-painel-laboratorial-completo-icd.pdf",
      "title_en": "Full laboratory panel",
      "title_pt": "Painel laboratorial completo",
      "src": "o21"
    },
    {
      "date": "2015-05-14",
      "laboratory": "PREVILAB Laboratório",
      "doctor": "Dr. Ruy Roberto Morando",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2015-05-14-painel-laboratorial-completo-previlab.pdf",
      "title_en": "Full panel + B12 + vitamin D + hepatitis B/C serologies + urine",
      "title_pt": "Painel completo + B12 + vitamina D + sorologias hepatite B/C + urina",
      "src": "o20"
    },
    {
      "date": "2014-03-08",
      "laboratory": "Laboratório Behring",
      "doctor": "Francisco Komatsu",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2014-03-08-acido-urico-hemograma-behring.pdf",
      "title_en": "Uric acid + complete blood count",
      "title_pt": "Ácido úrico + hemograma completo",
      "src": "o01"
    },
    {
      "date": "2013-07-27",
      "laboratory": "Laboratório Behring",
      "doctor": "Fernando L. A. Galante",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2013-07-27-hemograma-bioquimica-behring-2013.pdf",
      "title_en": "Liver, lipids, PSA, glucose, CBC, coagulation",
      "title_pt": "Hepático, lipídico, PSA, glicemia, hemograma, coagulograma",
      "src": "o10"
    },
    {
      "date": "2011-09-13",
      "laboratory": "Eugenia Cabianca – Análises Clínicas",
      "doctor": "Paulo Christian Machado",
      "pdf": "/api/lab-source?clerk=pending%3Apaulo-silotto-df3441&file=2011-09-13-perfil-lipidico-glicemia-cabianca.pdf",
      "title_en": "Lipid profile + glucose",
      "title_pt": "Perfil lipídico + glicemia",
      "src": "o25"
    }
  ],
  "panels": [
    {
      "slug": "hemogram",
      "title_en": "Complete blood count",
      "title_pt": "Hemograma completo",
      "subtitle_en": "Erythrocytes, leukocytes, platelets + differential",
      "subtitle_pt": "Eritrograma, leucograma, plaquetas + diferencial",
      "markers": [
        {
          "marker_en": "Red blood cells (RBC)",
          "marker_pt": "Eritrócitos (hemácias)",
          "unit": "milhões/mm³",
          "ref_low": 4.5,
          "ref_high": 5.5,
          "ref_text_en": "4.5 – 5.5 milhões/mm³",
          "ref_text_pt": "4,5 – 5,5 milhões/mm³",
          "points": [
            {
              "date": "2026-07-10",
              "value": 4.2,
              "flag": "L"
            },
            {
              "date": "2025-11-12",
              "value": 4.15,
              "flag": "L"
            },
            {
              "date": "2024-04-15",
              "value": 4.11,
              "flag": "L"
            },
            {
              "date": "2024-04-13",
              "value": 4.42
            },
            {
              "date": "2022-09-22",
              "value": 4.3
            },
            {
              "date": "2022-03-11",
              "value": 4.47
            },
            {
              "date": "2019-03-05",
              "value": 4.36,
              "flag": "L"
            },
            {
              "date": "2019-02-08",
              "value": 4.88
            },
            {
              "date": "2019-01-28",
              "value": 5.15
            },
            {
              "date": "2019-01-25",
              "value": 5
            },
            {
              "date": "2018-10-16",
              "value": 4.76
            },
            {
              "date": "2018-08-16",
              "value": 4.7
            },
            {
              "date": "2017-01-28",
              "value": 4.81
            },
            {
              "date": "2017-01-26",
              "value": 4.81
            },
            {
              "date": "2015-05-14",
              "value": 4.85
            },
            {
              "date": "2014-03-08",
              "value": 4.66
            },
            {
              "date": "2013-07-27",
              "value": 4.76
            }
          ]
        },
        {
          "marker_en": "Hemoglobin",
          "marker_pt": "Hemoglobina",
          "unit": "g/dL",
          "ref_low": 13.0,
          "ref_high": 17.5,
          "ref_text_en": "13 – 17.5 g/dL",
          "ref_text_pt": "13 – 17,5 g/dL",
          "points": [
            {
              "date": "2026-07-10",
              "value": 13.5
            },
            {
              "date": "2025-11-12",
              "value": 13.3
            },
            {
              "date": "2024-04-15",
              "value": 13.1
            },
            {
              "date": "2024-04-13",
              "value": 13.7
            },
            {
              "date": "2022-09-22",
              "value": 13.5
            },
            {
              "date": "2022-03-11",
              "value": 13.7
            },
            {
              "date": "2019-03-05",
              "value": 13.4,
              "flag": "L"
            },
            {
              "date": "2019-02-08",
              "value": 15.7
            },
            {
              "date": "2019-01-28",
              "value": 15.8
            },
            {
              "date": "2019-01-25",
              "value": 15.6
            },
            {
              "date": "2018-10-16",
              "value": 13.9
            },
            {
              "date": "2018-08-16",
              "value": 14.5
            },
            {
              "date": "2017-01-28",
              "value": 15.3
            },
            {
              "date": "2017-01-26",
              "value": 15.3
            },
            {
              "date": "2015-05-14",
              "value": 14.8
            },
            {
              "date": "2014-03-08",
              "value": 13.75
            },
            {
              "date": "2013-07-27",
              "value": 14.04
            }
          ]
        },
        {
          "marker_en": "Hematocrit",
          "marker_pt": "Hematócrito",
          "unit": "%",
          "ref_low": 40.0,
          "ref_high": 50.0,
          "ref_text_en": "40 – 50 %",
          "ref_text_pt": "40 – 50 %",
          "points": [
            {
              "date": "2026-07-10",
              "value": 36.7,
              "flag": "L"
            },
            {
              "date": "2025-11-12",
              "value": 40.3
            },
            {
              "date": "2024-04-15",
              "value": 37.3,
              "flag": "L"
            },
            {
              "date": "2024-04-13",
              "value": 41.5
            },
            {
              "date": "2022-09-22",
              "value": 39.9,
              "flag": "L"
            },
            {
              "date": "2022-03-11",
              "value": 41.1
            },
            {
              "date": "2019-03-05",
              "value": 38.7,
              "flag": "L"
            },
            {
              "date": "2019-02-08",
              "value": 42.2
            },
            {
              "date": "2019-01-28",
              "value": 46.2
            },
            {
              "date": "2019-01-25",
              "value": 45
            },
            {
              "date": "2018-10-16",
              "value": 43
            },
            {
              "date": "2018-08-16",
              "value": 42.8
            },
            {
              "date": "2017-01-28",
              "value": 44.4
            },
            {
              "date": "2017-01-26",
              "value": 44.4
            },
            {
              "date": "2015-05-14",
              "value": 43.9
            },
            {
              "date": "2014-03-08",
              "value": 41
            },
            {
              "date": "2013-07-27",
              "value": 40.1
            }
          ]
        },
        {
          "marker_en": "MCV",
          "marker_pt": "VCM",
          "unit": "fL",
          "ref_low": 80.0,
          "ref_high": 100.0,
          "ref_text_en": "80 – 100 fL",
          "ref_text_pt": "80 – 100 fL",
          "points": [
            {
              "date": "2026-07-10",
              "value": 87.8
            },
            {
              "date": "2025-11-12",
              "value": 97.1
            },
            {
              "date": "2024-04-15",
              "value": 90.8
            },
            {
              "date": "2024-04-13",
              "value": 93.89
            },
            {
              "date": "2022-09-22",
              "value": 92.8
            },
            {
              "date": "2022-03-11",
              "value": 92
            },
            {
              "date": "2019-03-05",
              "value": 88.76
            },
            {
              "date": "2019-02-08",
              "value": 86.4
            },
            {
              "date": "2019-01-28",
              "value": 89.7
            },
            {
              "date": "2019-01-25",
              "value": 90
            },
            {
              "date": "2018-10-16",
              "value": 90.3
            },
            {
              "date": "2018-08-16",
              "value": 91.1
            },
            {
              "date": "2017-01-28",
              "value": 92
            },
            {
              "date": "2017-01-26",
              "value": 92
            },
            {
              "date": "2015-05-14",
              "value": 90.5
            },
            {
              "date": "2014-03-08",
              "value": 87.98
            },
            {
              "date": "2013-07-27",
              "value": 84.24
            }
          ]
        },
        {
          "marker_en": "MCH",
          "marker_pt": "HCM",
          "unit": "pg",
          "ref_low": 26.0,
          "ref_high": 32.0,
          "ref_text_en": "26 – 32 pg",
          "ref_text_pt": "26 – 32 pg",
          "points": [
            {
              "date": "2026-07-10",
              "value": 32.3,
              "flag": "H"
            },
            {
              "date": "2025-11-12",
              "value": 32.1
            },
            {
              "date": "2024-04-15",
              "value": 31.9
            },
            {
              "date": "2024-04-13",
              "value": 30.99
            },
            {
              "date": "2022-09-22",
              "value": 31.4
            },
            {
              "date": "2022-03-11",
              "value": 30.7
            },
            {
              "date": "2019-03-05",
              "value": 30.73
            },
            {
              "date": "2019-02-08",
              "value": 32.1,
              "flag": "H"
            },
            {
              "date": "2019-01-28",
              "value": 30.6
            },
            {
              "date": "2019-01-25",
              "value": 31.2
            },
            {
              "date": "2018-10-16",
              "value": 29.2
            },
            {
              "date": "2018-08-16",
              "value": 30.9
            },
            {
              "date": "2017-01-28",
              "value": 32
            },
            {
              "date": "2017-01-26",
              "value": 32
            },
            {
              "date": "2015-05-14",
              "value": 30.5
            },
            {
              "date": "2014-03-08",
              "value": 29.5
            },
            {
              "date": "2013-07-27",
              "value": 29.49
            }
          ]
        },
        {
          "marker_en": "MCHC",
          "marker_pt": "CHCM",
          "unit": "g/dL",
          "ref_low": 31.5,
          "ref_high": 36.5,
          "ref_text_en": "31.5 – 36.5 g/dL",
          "ref_text_pt": "31,5 – 36,5 g/dL",
          "points": [
            {
              "date": "2026-07-10",
              "value": 36.8,
              "flag": "H"
            },
            {
              "date": "2025-11-12",
              "value": 33
            },
            {
              "date": "2024-04-15",
              "value": 35.1,
              "flag": "H"
            },
            {
              "date": "2024-04-13",
              "value": 33.01
            },
            {
              "date": "2022-09-22",
              "value": 33.8
            },
            {
              "date": "2022-03-11",
              "value": 33.3
            },
            {
              "date": "2019-03-05",
              "value": 34.63
            },
            {
              "date": "2019-02-08",
              "value": 37.2,
              "flag": "H"
            },
            {
              "date": "2019-01-28",
              "value": 34.1
            },
            {
              "date": "2019-01-25",
              "value": 34.6
            },
            {
              "date": "2018-10-16",
              "value": 32.3
            },
            {
              "date": "2018-08-16",
              "value": 33.9
            },
            {
              "date": "2017-01-28",
              "value": 35
            },
            {
              "date": "2017-01-26",
              "value": 35
            },
            {
              "date": "2015-05-14",
              "value": 33.7
            },
            {
              "date": "2014-03-08",
              "value": 33.53
            },
            {
              "date": "2013-07-27",
              "value": 35.01
            }
          ]
        },
        {
          "marker_en": "RDW",
          "marker_pt": "RDW",
          "unit": "%",
          "ref_low": 11.5,
          "ref_high": 14.6,
          "ref_text_en": "11.5 – 14.6 %",
          "ref_text_pt": "11,5 – 14,6 %",
          "points": [
            {
              "date": "2026-07-10",
              "value": 12.5
            },
            {
              "date": "2025-11-12",
              "value": 12.7
            },
            {
              "date": "2024-04-15",
              "value": 12.7
            },
            {
              "date": "2024-04-13",
              "value": 13.9
            },
            {
              "date": "2022-09-22",
              "value": 12.9
            },
            {
              "date": "2022-03-11",
              "value": 13.2
            },
            {
              "date": "2019-03-05",
              "value": 13.4
            },
            {
              "date": "2019-02-08",
              "value": 12
            },
            {
              "date": "2019-01-28",
              "value": 11.9
            },
            {
              "date": "2019-01-25",
              "value": 11.9
            },
            {
              "date": "2018-10-16",
              "value": 11.4,
              "flag": "L"
            },
            {
              "date": "2018-08-16",
              "value": 12.5
            },
            {
              "date": "2017-01-28",
              "value": 11
            },
            {
              "date": "2017-01-26",
              "value": 11
            },
            {
              "date": "2015-05-14",
              "value": 13.1
            },
            {
              "date": "2014-03-08",
              "value": 10.4,
              "flag": "L"
            },
            {
              "date": "2013-07-27",
              "value": 11.2,
              "flag": "L"
            }
          ]
        },
        {
          "marker_en": "RDW-SD",
          "marker_pt": "RDW-SD",
          "unit": "fL",
          "ref_low": 37.0,
          "ref_high": 54.0,
          "ref_text_en": "37 – 54 fL",
          "ref_text_pt": "37 – 54 fL",
          "points": [
            {
              "date": "2019-02-08",
              "value": 41.9
            },
            {
              "date": "2019-01-28",
              "value": 41.6
            },
            {
              "date": "2019-01-25",
              "value": 41.6
            }
          ]
        },
        {
          "marker_en": "White blood cells (WBC)",
          "marker_pt": "Leucócitos",
          "unit": "/mm³",
          "ref_low": 4000,
          "ref_high": 11000,
          "ref_text_en": "4000 – 11000 /mm³",
          "ref_text_pt": "4000 – 11000 /mm³",
          "points": [
            {
              "date": "2026-07-10",
              "value": 8810
            },
            {
              "date": "2025-11-12",
              "value": 4520
            },
            {
              "date": "2024-04-15",
              "value": 3190,
              "flag": "L"
            },
            {
              "date": "2024-04-13",
              "value": 4500
            },
            {
              "date": "2022-09-22",
              "value": 4900
            },
            {
              "date": "2022-03-11",
              "value": 4300
            },
            {
              "date": "2019-03-05",
              "value": 4450
            },
            {
              "date": "2019-02-08",
              "value": 7300
            },
            {
              "date": "2019-01-28",
              "value": 8700
            },
            {
              "date": "2019-01-25",
              "value": 10800,
              "flag": "H"
            },
            {
              "date": "2018-10-16",
              "value": 5
            },
            {
              "date": "2018-08-16",
              "value": 4700
            },
            {
              "date": "2017-01-28",
              "value": 4300
            },
            {
              "date": "2017-01-26",
              "value": 4300
            },
            {
              "date": "2015-05-14",
              "value": 5370
            },
            {
              "date": "2014-03-08",
              "value": 5200
            },
            {
              "date": "2013-07-27",
              "value": 5800
            }
          ]
        },
        {
          "marker_en": "Platelets",
          "marker_pt": "Plaquetas",
          "unit": "/mm³",
          "ref_low": 150000,
          "ref_high": 450000,
          "ref_text_en": "150000 – 450000 /mm³",
          "ref_text_pt": "150000 – 450000 /mm³",
          "points": [
            {
              "date": "2026-07-10",
              "value": 239000
            },
            {
              "date": "2025-11-12",
              "value": 222000
            },
            {
              "date": "2024-04-15",
              "value": 171000
            },
            {
              "date": "2024-04-13",
              "value": 207000
            },
            {
              "date": "2022-09-22",
              "value": 224
            },
            {
              "date": "2022-03-11",
              "value": 213
            },
            {
              "date": "2019-03-05",
              "value": 152000
            },
            {
              "date": "2019-02-08",
              "value": 289000
            },
            {
              "date": "2019-01-28",
              "value": 239000
            },
            {
              "date": "2019-01-25",
              "value": 269000
            },
            {
              "date": "2018-10-16",
              "value": 178000
            },
            {
              "date": "2018-08-16",
              "value": 189000
            },
            {
              "date": "2017-01-28",
              "value": 177000
            },
            {
              "date": "2017-01-26",
              "value": 177000
            },
            {
              "date": "2015-05-14",
              "value": 219000
            },
            {
              "date": "2014-03-08",
              "value": 193000
            },
            {
              "date": "2013-07-27",
              "value": 169000
            }
          ]
        },
        {
          "marker_en": "Mean platelet volume (MPV)",
          "marker_pt": "Volume plaquetário médio (VPM)",
          "unit": "fL",
          "ref_low": 7.8,
          "ref_high": 11.0,
          "ref_text_en": "7.8 – 11 fL",
          "ref_text_pt": "7,8 – 11 fL",
          "points": [
            {
              "date": "2025-11-12",
              "value": 9.5
            },
            {
              "date": "2024-04-15",
              "value": 8.4
            },
            {
              "date": "2024-04-13",
              "value": 7.5
            },
            {
              "date": "2022-09-22",
              "value": 7.5,
              "flag": "L"
            },
            {
              "date": "2022-03-11",
              "value": 7.3,
              "flag": "L"
            },
            {
              "date": "2019-02-08",
              "value": 8.2
            },
            {
              "date": "2019-01-28",
              "value": 8.6
            },
            {
              "date": "2019-01-25",
              "value": 8.4
            },
            {
              "date": "2014-03-08",
              "value": 6.6
            },
            {
              "date": "2013-07-27",
              "value": 6.4
            }
          ]
        },
        {
          "marker_en": "Platelet distribution width (PDW)",
          "marker_pt": "PDW",
          "unit": "%",
          "ref_low": 9.0,
          "ref_high": 17.0,
          "ref_text_en": "9 – 17 %",
          "ref_text_pt": "9 – 17 %",
          "points": [
            {
              "date": "2024-04-15",
              "value": 16.4
            },
            {
              "date": "2014-03-08",
              "value": 10.7,
              "flag": "L"
            },
            {
              "date": "2013-07-27",
              "value": 8.7,
              "flag": "L"
            }
          ]
        },
        {
          "marker_en": "Plateletcrit (PCT)",
          "marker_pt": "Plaquetócrito",
          "unit": "%",
          "ref_low": 0.108,
          "ref_high": 0.282,
          "ref_text_en": "0.108 – 0.282 %",
          "ref_text_pt": "0,108 – 0,282 %",
          "points": [
            {
              "date": "2024-04-15",
              "value": 0.14
            },
            {
              "date": "2024-04-13",
              "value": 0.16
            },
            {
              "date": "2014-03-08",
              "value": 0.128,
              "flag": "L"
            },
            {
              "date": "2013-07-27",
              "value": 0.108,
              "flag": "L"
            }
          ]
        },
        {
          "marker_en": "RBC morphology",
          "marker_pt": "Morfologia eritrocitária",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": null,
          "ref_text_pt": null,
          "points": [
            {
              "date": "2024-04-13",
              "value_text": "Hemácias normocíticas e normocrômicas. Sem alterações degenerativas."
            }
          ]
        },
        {
          "marker_en": "Segmented neutrophils (%)",
          "marker_pt": "Neutrófilos segmentados (relativo)",
          "unit": "%",
          "ref_low": 45,
          "ref_high": 66,
          "ref_text_en": "45 – 66 %",
          "ref_text_pt": "45 – 66 %",
          "points": [
            {
              "date": "2026-07-10",
              "value": 59.4
            },
            {
              "date": "2025-11-12",
              "value": 51.1
            },
            {
              "date": "2024-04-15",
              "value": 70.6,
              "flag": "H"
            },
            {
              "date": "2019-02-08",
              "value": 64
            },
            {
              "date": "2019-01-28",
              "value": 63
            },
            {
              "date": "2019-01-25",
              "value": 67
            },
            {
              "date": "2018-10-16",
              "value": 49
            },
            {
              "date": "2018-08-16",
              "value": 52
            },
            {
              "date": "2017-01-26",
              "value": 50.5
            }
          ]
        },
        {
          "marker_en": "Segmented neutrophils (abs)",
          "marker_pt": "Neutrófilos segmentados (absoluto)",
          "unit": "/mm³",
          "ref_low": 2000,
          "ref_high": 7000,
          "ref_text_en": "2000 – 7000 /mm³",
          "ref_text_pt": "2000 – 7000 /mm³",
          "points": [
            {
              "date": "2026-07-10",
              "value": 5233
            },
            {
              "date": "2025-11-12",
              "value": 2310
            },
            {
              "date": "2024-04-13",
              "value": 3362
            },
            {
              "date": "2022-09-22",
              "value": 2450
            },
            {
              "date": "2022-03-11",
              "value": 2073
            },
            {
              "date": "2019-02-08",
              "value": 4672
            },
            {
              "date": "2019-01-28",
              "value": 5481
            },
            {
              "date": "2019-01-25",
              "value": 7236
            },
            {
              "date": "2018-10-16",
              "value": 2.45
            },
            {
              "date": "2018-08-16",
              "value": 2444
            },
            {
              "date": "2017-01-28",
              "value": 2171.5
            },
            {
              "date": "2017-01-26",
              "value": 2171.5
            },
            {
              "date": "2014-03-08",
              "value": 3016
            },
            {
              "date": "2013-07-27",
              "value": 3074
            }
          ]
        },
        {
          "marker_en": "Neutrophils (total) (%)",
          "marker_pt": "Neutrófilos (total) (relativo)",
          "unit": "%",
          "ref_low": 40.0,
          "ref_high": 70.0,
          "ref_text_en": "40 – 70 %",
          "ref_text_pt": "40 – 70 %",
          "points": [
            {
              "date": "2018-10-16",
              "value": 49
            },
            {
              "date": "2015-05-14",
              "value": 44.5,
              "flag": "L"
            }
          ]
        },
        {
          "marker_en": "Neutrophils (total) (abs)",
          "marker_pt": "Neutrófilos (total) (absoluto)",
          "unit": "/mm³",
          "ref_low": 1800,
          "ref_high": 8000,
          "ref_text_en": "1800 – 8000 /mm³",
          "ref_text_pt": "1800 – 8000 /mm³",
          "points": [
            {
              "date": "2024-04-13",
              "value": 3366
            },
            {
              "date": "2019-03-05",
              "value": 1850
            },
            {
              "date": "2018-10-16",
              "value": 2.45
            },
            {
              "date": "2015-05-14",
              "value": 2390
            },
            {
              "date": "2014-03-08",
              "value": 3120
            },
            {
              "date": "2013-07-27",
              "value": 3248
            }
          ]
        },
        {
          "marker_en": "Band neutrophils (%)",
          "marker_pt": "Bastonetes (relativo)",
          "unit": "%",
          "ref_low": 0.0,
          "ref_high": 5.0,
          "ref_text_en": "0 – 5 %",
          "ref_text_pt": "0 – 5 %",
          "points": [
            {
              "date": "2026-07-10",
              "value": 0
            },
            {
              "date": "2024-04-15",
              "value": 0
            },
            {
              "date": "2019-02-08",
              "value": 5
            },
            {
              "date": "2019-01-28",
              "value": 4
            },
            {
              "date": "2019-01-25",
              "value": 10,
              "flag": "H"
            },
            {
              "date": "2018-10-16",
              "value": 0
            },
            {
              "date": "2018-08-16",
              "value": 0
            },
            {
              "date": "2017-01-26",
              "value": 0
            }
          ]
        },
        {
          "marker_en": "Band neutrophils (abs)",
          "marker_pt": "Bastonetes (absoluto)",
          "unit": "/mm³",
          "ref_low": null,
          "ref_high": 840,
          "ref_text_en": "< 840 /mm³",
          "ref_text_pt": "< 840 /mm³",
          "points": [
            {
              "date": "2026-07-10",
              "value": 0
            },
            {
              "date": "2024-04-13",
              "value": 5
            },
            {
              "date": "2022-09-22",
              "value": 0
            },
            {
              "date": "2022-03-11",
              "value": 0
            },
            {
              "date": "2019-02-08",
              "value": 365
            },
            {
              "date": "2019-01-28",
              "value": 348
            },
            {
              "date": "2019-01-25",
              "value": 1080,
              "flag": "H"
            },
            {
              "date": "2018-10-16",
              "value": 0
            },
            {
              "date": "2018-08-16",
              "value": 0
            },
            {
              "date": "2017-01-28",
              "value": 0
            },
            {
              "date": "2017-01-26",
              "value": 0
            },
            {
              "date": "2014-03-08",
              "value": 104
            },
            {
              "date": "2013-07-27",
              "value": 174
            }
          ]
        },
        {
          "marker_en": "Eosinophils (%)",
          "marker_pt": "Eosinófilos (relativo)",
          "unit": "%",
          "ref_low": 1,
          "ref_high": 4,
          "ref_text_en": "1 – 4 %",
          "ref_text_pt": "1 – 4 %",
          "points": [
            {
              "date": "2026-07-10",
              "value": 0.2
            },
            {
              "date": "2025-11-12",
              "value": 2.5
            },
            {
              "date": "2024-04-15",
              "value": 2.2
            },
            {
              "date": "2019-02-08",
              "value": 1
            },
            {
              "date": "2019-01-28",
              "value": 1
            },
            {
              "date": "2019-01-25",
              "value": 0,
              "flag": "L"
            },
            {
              "date": "2018-10-16",
              "value": 2.9
            },
            {
              "date": "2018-08-16",
              "value": 2
            },
            {
              "date": "2017-01-26",
              "value": 2.3
            },
            {
              "date": "2015-05-14",
              "value": 4.7,
              "flag": "H"
            }
          ]
        },
        {
          "marker_en": "Eosinophils (abs)",
          "marker_pt": "Eosinófilos (absoluto)",
          "unit": "/mm³",
          "ref_low": 20,
          "ref_high": 500,
          "ref_text_en": "20 – 500 /mm³",
          "ref_text_pt": "20 – 500 /mm³",
          "points": [
            {
              "date": "2026-07-10",
              "value": 18,
              "flag": "L"
            },
            {
              "date": "2025-11-12",
              "value": 113
            },
            {
              "date": "2024-04-13",
              "value": 63
            },
            {
              "date": "2022-09-22",
              "value": 461,
              "flag": "H"
            },
            {
              "date": "2022-03-11",
              "value": 120
            },
            {
              "date": "2019-03-05",
              "value": 140
            },
            {
              "date": "2019-02-08",
              "value": 73
            },
            {
              "date": "2019-01-28",
              "value": 87
            },
            {
              "date": "2019-01-25",
              "value": 0,
              "flag": "L"
            },
            {
              "date": "2018-10-16",
              "value": 0.14
            },
            {
              "date": "2018-08-16",
              "value": 94
            },
            {
              "date": "2017-01-28",
              "value": 98.9,
              "flag": "L"
            },
            {
              "date": "2017-01-26",
              "value": 98.9,
              "flag": "L"
            },
            {
              "date": "2015-05-14",
              "value": 252
            },
            {
              "date": "2014-03-08",
              "value": 156
            },
            {
              "date": "2013-07-27",
              "value": 174
            }
          ]
        },
        {
          "marker_en": "Basophils (%)",
          "marker_pt": "Basófilos (relativo)",
          "unit": "%",
          "ref_low": 0,
          "ref_high": 1,
          "ref_text_en": "0 – 1 %",
          "ref_text_pt": "0 – 1 %",
          "points": [
            {
              "date": "2026-07-10",
              "value": 0.2
            },
            {
              "date": "2025-11-12",
              "value": 0.9
            },
            {
              "date": "2024-04-15",
              "value": 0.1
            },
            {
              "date": "2019-02-08",
              "value": 0
            },
            {
              "date": "2019-01-28",
              "value": 0
            },
            {
              "date": "2019-01-25",
              "value": 0
            },
            {
              "date": "2018-10-16",
              "value": 1
            },
            {
              "date": "2018-08-16",
              "value": 0
            },
            {
              "date": "2017-01-26",
              "value": 0.2
            },
            {
              "date": "2015-05-14",
              "value": 0.4
            }
          ]
        },
        {
          "marker_en": "Basophils (abs)",
          "marker_pt": "Basófilos (absoluto)",
          "unit": "/mm³",
          "ref_low": 0,
          "ref_high": 200,
          "ref_text_en": "0 – 200 /mm³",
          "ref_text_pt": "0 – 200 /mm³",
          "points": [
            {
              "date": "2026-07-10",
              "value": 18
            },
            {
              "date": "2025-11-12",
              "value": 41
            },
            {
              "date": "2024-04-13",
              "value": 0
            },
            {
              "date": "2022-09-22",
              "value": 29
            },
            {
              "date": "2022-03-11",
              "value": 22
            },
            {
              "date": "2019-03-05",
              "value": 20
            },
            {
              "date": "2019-02-08",
              "value": 0
            },
            {
              "date": "2019-01-28",
              "value": 0
            },
            {
              "date": "2019-01-25",
              "value": 0
            },
            {
              "date": "2018-10-16",
              "value": 0.05
            },
            {
              "date": "2018-08-16",
              "value": 0
            },
            {
              "date": "2017-01-28",
              "value": 8.6
            },
            {
              "date": "2017-01-26",
              "value": 8.6
            },
            {
              "date": "2015-05-14",
              "value": 21
            },
            {
              "date": "2014-03-08",
              "value": 0
            },
            {
              "date": "2013-07-27",
              "value": 0
            }
          ]
        },
        {
          "marker_en": "Lymphocytes (%)",
          "marker_pt": "Linfócitos (relativo)",
          "unit": "%",
          "ref_low": 18,
          "ref_high": 36,
          "ref_text_en": "18 – 36 %",
          "ref_text_pt": "18 – 36 %",
          "points": [
            {
              "date": "2026-07-10",
              "value": 24.6
            },
            {
              "date": "2025-11-12",
              "value": 34.3
            },
            {
              "date": "2024-04-15",
              "value": 14.4,
              "flag": "L"
            },
            {
              "date": "2019-02-08",
              "value": 26
            },
            {
              "date": "2019-01-28",
              "value": 26
            },
            {
              "date": "2019-01-25",
              "value": 21,
              "flag": "L"
            },
            {
              "date": "2018-10-16",
              "value": 36.5
            },
            {
              "date": "2018-08-16",
              "value": 36
            },
            {
              "date": "2017-01-26",
              "value": 36.9
            },
            {
              "date": "2015-05-14",
              "value": 38.7
            }
          ]
        },
        {
          "marker_en": "Lymphocytes (abs)",
          "marker_pt": "Linfócitos (absoluto)",
          "unit": "/mm³",
          "ref_low": 1000,
          "ref_high": 3500,
          "ref_text_en": "1000 – 3500 /mm³",
          "ref_text_pt": "1000 – 3500 /mm³",
          "points": [
            {
              "date": "2026-07-10",
              "value": 2167
            },
            {
              "date": "2025-11-12",
              "value": 1550
            },
            {
              "date": "2024-04-13",
              "value": 666,
              "flag": "L"
            },
            {
              "date": "2022-09-22",
              "value": 1480
            },
            {
              "date": "2022-03-11",
              "value": 1634
            },
            {
              "date": "2019-03-05",
              "value": 1700
            },
            {
              "date": "2019-02-08",
              "value": 1898
            },
            {
              "date": "2019-01-28",
              "value": 2262
            },
            {
              "date": "2019-01-25",
              "value": 2268
            },
            {
              "date": "2018-10-16",
              "value": 1.82
            },
            {
              "date": "2018-08-16",
              "value": 1692
            },
            {
              "date": "2017-01-28",
              "value": 1586.7
            },
            {
              "date": "2017-01-26",
              "value": 1586.7
            },
            {
              "date": "2015-05-14",
              "value": 2078
            },
            {
              "date": "2014-03-08",
              "value": 1560
            },
            {
              "date": "2013-07-27",
              "value": 1798
            }
          ]
        },
        {
          "marker_en": "Monocytes (%)",
          "marker_pt": "Monócitos (relativo)",
          "unit": "%",
          "ref_low": 2,
          "ref_high": 10,
          "ref_text_en": "2 – 10 %",
          "ref_text_pt": "2 – 10 %",
          "points": [
            {
              "date": "2026-07-10",
              "value": 15.6
            },
            {
              "date": "2025-11-12",
              "value": 11.2,
              "flag": "H"
            },
            {
              "date": "2024-04-15",
              "value": 12.7,
              "flag": "H"
            },
            {
              "date": "2019-02-08",
              "value": 4
            },
            {
              "date": "2019-01-28",
              "value": 6
            },
            {
              "date": "2019-01-25",
              "value": 2
            },
            {
              "date": "2018-10-16",
              "value": 10.6,
              "flag": "H"
            },
            {
              "date": "2018-08-16",
              "value": 10,
              "flag": "H"
            },
            {
              "date": "2017-01-26",
              "value": 10.1
            },
            {
              "date": "2015-05-14",
              "value": 11.7,
              "flag": "H"
            }
          ]
        },
        {
          "marker_en": "Monocytes (abs)",
          "marker_pt": "Monócitos (absoluto)",
          "unit": "/mm³",
          "ref_low": 200,
          "ref_high": 1000,
          "ref_text_en": "200 – 1000 /mm³",
          "ref_text_pt": "200 – 1000 /mm³",
          "points": [
            {
              "date": "2026-07-10",
              "value": 1374,
              "flag": "H"
            },
            {
              "date": "2025-11-12",
              "value": 506
            },
            {
              "date": "2024-04-13",
              "value": 405
            },
            {
              "date": "2022-09-22",
              "value": 480
            },
            {
              "date": "2022-03-11",
              "value": 452
            },
            {
              "date": "2019-03-05",
              "value": 740
            },
            {
              "date": "2019-02-08",
              "value": 292,
              "flag": "L"
            },
            {
              "date": "2019-01-28",
              "value": 522
            },
            {
              "date": "2019-01-25",
              "value": 216,
              "flag": "L"
            },
            {
              "date": "2018-10-16",
              "value": 0.53
            },
            {
              "date": "2018-08-16",
              "value": 470
            },
            {
              "date": "2017-01-28",
              "value": 434.3
            },
            {
              "date": "2017-01-26",
              "value": 434.3
            },
            {
              "date": "2015-05-14",
              "value": 628
            },
            {
              "date": "2014-03-08",
              "value": 364
            },
            {
              "date": "2013-07-27",
              "value": 580
            }
          ]
        },
        {
          "marker_en": "Granulocytes (%)",
          "marker_pt": "Granulócitos (relativo)",
          "unit": "%",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": null,
          "ref_text_pt": null,
          "points": [
            {
              "date": "2017-01-26",
              "value": 53
            }
          ]
        },
        {
          "marker_en": "Granulocytes (abs)",
          "marker_pt": "Granulócitos (absoluto)",
          "unit": "/mm³",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "53 %",
          "ref_text_pt": "53 %",
          "points": [
            {
              "date": "2017-01-28",
              "value": 2279
            },
            {
              "date": "2017-01-26",
              "value": 2279
            }
          ]
        }
      ]
    },
    {
      "slug": "glycemic",
      "title_en": "Glycemic panel",
      "title_pt": "Painel glicêmico",
      "subtitle_en": "Fasting & post-prandial glucose, HbA1c, insulin",
      "subtitle_pt": "Glicemia de jejum e pós-prandial, HbA1c, insulina",
      "markers": [
        {
          "marker_en": "Fasting glucose",
          "marker_pt": "Glicemia de jejum",
          "unit": "mg/dL",
          "ref_low": 70,
          "ref_high": 99,
          "ref_text_en": "70 – 99 mg/dL",
          "ref_text_pt": "70 – 99 mg/dL",
          "points": [
            {
              "date": "2025-11-12",
              "value": 100,
              "flag": "H"
            },
            {
              "date": "2023-02-24",
              "value": 100,
              "flag": "H"
            },
            {
              "date": "2022-09-22",
              "value": 108,
              "flag": "H"
            },
            {
              "date": "2022-08-12",
              "value": 110,
              "flag": "H"
            },
            {
              "date": "2022-04-01",
              "value": 98
            },
            {
              "date": "2022-03-11",
              "value": 114,
              "flag": "H"
            },
            {
              "date": "2019-02-08",
              "value": 115,
              "flag": "H"
            },
            {
              "date": "2018-08-16",
              "value": 96
            },
            {
              "date": "2017-02-03",
              "value": 108,
              "flag": "H"
            },
            {
              "date": "2017-01-28",
              "value": 108,
              "flag": "H"
            },
            {
              "date": "2017-01-26",
              "value": 108,
              "flag": "H"
            },
            {
              "date": "2015-05-14",
              "value": 101,
              "flag": "H"
            },
            {
              "date": "2013-07-27",
              "value": 104.3
            },
            {
              "date": "2011-09-13",
              "value": 102
            }
          ]
        },
        {
          "marker_en": "Post-prandial glucose",
          "marker_pt": "Glicemia pós-prandial",
          "unit": "mg/dL",
          "ref_low": 70,
          "ref_high": 110,
          "ref_text_en": "70 – 110 mg/dL",
          "ref_text_pt": "70 – 110 mg/dL",
          "points": [
            {
              "date": "2017-02-03",
              "value": 99
            }
          ]
        },
        {
          "marker_en": "HbA1c (glycated hemoglobin)",
          "marker_pt": "Hemoglobina glicada (HbA1c)",
          "unit": "%",
          "ref_low": null,
          "ref_high": 5.7,
          "ref_text_en": "< 5.7 %",
          "ref_text_pt": "< 5,7 %",
          "points": [
            {
              "date": "2023-02-24",
              "value": 4.8
            },
            {
              "date": "2022-09-22",
              "value": 5.4
            },
            {
              "date": "2022-08-12",
              "value": 5
            },
            {
              "date": "2022-04-01",
              "value": 5.3
            },
            {
              "date": "2022-03-11",
              "value": 5.4
            },
            {
              "date": "2019-02-08",
              "value": 5.6
            },
            {
              "date": "2017-01-28",
              "value": 5.5
            },
            {
              "date": "2017-01-26",
              "value": 5.5
            }
          ]
        },
        {
          "marker_en": "Estimated average glucose",
          "marker_pt": "Glicemia média estimada",
          "unit": "mg/dL",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Valor derivado da HbA1c; não deve ser utilizado na avaliação de indivíduos não diabéticos",
          "ref_text_pt": "Valor derivado da HbA1c; não deve ser utilizado na avaliação de indivíduos não diabéticos",
          "points": [
            {
              "date": "2023-02-24",
              "value": 91
            },
            {
              "date": "2022-08-12",
              "value": 97
            },
            {
              "date": "2022-04-01",
              "value": 105.4
            },
            {
              "date": "2022-03-11",
              "value": 108.28
            },
            {
              "date": "2019-02-08",
              "value": 114
            }
          ]
        },
        {
          "marker_en": "Insulin",
          "marker_pt": "Insulina",
          "unit": "µUI/mL",
          "ref_low": 1.9,
          "ref_high": 23.0,
          "ref_text_en": "1.9 – 23 µUI/mL",
          "ref_text_pt": "1,9 – 23 µUI/mL",
          "points": [
            {
              "date": "2023-02-24",
              "value": 7.6
            },
            {
              "date": "2015-05-14",
              "value": 7.37
            }
          ]
        },
        {
          "marker_en": "Hb A (HPLC)",
          "marker_pt": "Hb A (HPLC)",
          "unit": "%",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": null,
          "ref_text_pt": null,
          "points": [
            {
              "date": "2023-02-24",
              "value": 87.2
            },
            {
              "date": "2022-08-12",
              "value": 87.4
            },
            {
              "date": "2019-02-08",
              "value": 86.2
            }
          ]
        },
        {
          "marker_en": "Hb A1a (HPLC)",
          "marker_pt": "Hb A1a (HPLC)",
          "unit": "%",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": null,
          "ref_text_pt": null,
          "points": [
            {
              "date": "2023-02-24",
              "value": 0
            },
            {
              "date": "2022-08-12",
              "value": 0.9
            },
            {
              "date": "2019-02-08",
              "value": 0
            }
          ]
        },
        {
          "marker_en": "Hb A1b (HPLC)",
          "marker_pt": "Hb A1b (HPLC)",
          "unit": "%",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": null,
          "ref_text_pt": null,
          "points": [
            {
              "date": "2023-02-24",
              "value": 0.8
            },
            {
              "date": "2022-08-12",
              "value": 0.8
            },
            {
              "date": "2019-02-08",
              "value": 0.9
            }
          ]
        },
        {
          "marker_en": "Labile HbA1c (HPLC)",
          "marker_pt": "HbA1c lábil (HPLC)",
          "unit": "%",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": null,
          "ref_text_pt": null,
          "points": [
            {
              "date": "2023-02-24",
              "value": 1.9
            },
            {
              "date": "2022-08-12",
              "value": 2
            },
            {
              "date": "2019-02-08",
              "value": 2.1
            }
          ]
        },
        {
          "marker_en": "Hb F – fetal (HPLC)",
          "marker_pt": "Hb F – fetal (HPLC)",
          "unit": "%",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": null,
          "ref_text_pt": null,
          "points": [
            {
              "date": "2023-02-24",
              "value": 0.8
            },
            {
              "date": "2022-08-12",
              "value": 0.7
            },
            {
              "date": "2019-02-08",
              "value": 0.9
            }
          ]
        }
      ]
    },
    {
      "slug": "lipid",
      "title_en": "Lipid profile",
      "title_pt": "Perfil lipídico",
      "subtitle_en": "Total, HDL, LDL, VLDL, non-HDL, triglycerides",
      "subtitle_pt": "Total, HDL, LDL, VLDL, não-HDL, triglicérides",
      "markers": [
        {
          "marker_en": "Total cholesterol",
          "marker_pt": "Colesterol total",
          "unit": "mg/dL",
          "ref_low": null,
          "ref_high": 190,
          "ref_text_en": "< 190 mg/dL",
          "ref_text_pt": "< 190 mg/dL",
          "points": [
            {
              "date": "2025-11-12",
              "value": 215,
              "flag": "H"
            },
            {
              "date": "2023-02-24",
              "value": 241,
              "flag": "H"
            },
            {
              "date": "2022-09-22",
              "value": 219,
              "flag": "H"
            },
            {
              "date": "2022-08-12",
              "value": 245,
              "flag": "H"
            },
            {
              "date": "2022-04-01",
              "value": 235,
              "flag": "H"
            },
            {
              "date": "2022-03-11",
              "value": 235,
              "flag": "H"
            },
            {
              "date": "2018-08-16",
              "value": 208,
              "flag": "H"
            },
            {
              "date": "2017-01-28",
              "value": 213,
              "flag": "H"
            },
            {
              "date": "2017-01-26",
              "value": 213,
              "flag": "H"
            },
            {
              "date": "2015-05-14",
              "value": 210,
              "flag": "H"
            },
            {
              "date": "2013-07-27",
              "value": 217.7,
              "flag": "H"
            },
            {
              "date": "2011-09-13",
              "value": 221,
              "flag": "H"
            }
          ]
        },
        {
          "marker_en": "HDL cholesterol",
          "marker_pt": "Colesterol HDL",
          "unit": "mg/dL",
          "ref_low": 40,
          "ref_high": null,
          "ref_text_en": "> 40 mg/dL",
          "ref_text_pt": "> 40 mg/dL",
          "points": [
            {
              "date": "2025-11-12",
              "value": 83
            },
            {
              "date": "2023-02-24",
              "value": 92.8
            },
            {
              "date": "2022-09-22",
              "value": 78
            },
            {
              "date": "2022-08-12",
              "value": 80.3
            },
            {
              "date": "2022-04-01",
              "value": 80
            },
            {
              "date": "2022-03-11",
              "value": 76
            },
            {
              "date": "2018-08-16",
              "value": 75
            },
            {
              "date": "2017-01-28",
              "value": 77
            },
            {
              "date": "2017-01-26",
              "value": 77
            },
            {
              "date": "2015-05-14",
              "value": 60
            },
            {
              "date": "2013-07-27",
              "value": 62
            },
            {
              "date": "2011-09-13",
              "value": 61
            }
          ]
        },
        {
          "marker_en": "LDL cholesterol",
          "marker_pt": "Colesterol LDL",
          "unit": "mg/dL",
          "ref_low": null,
          "ref_high": 130,
          "ref_text_en": "< 130 mg/dL",
          "ref_text_pt": "< 130 mg/dL",
          "points": [
            {
              "date": "2022-09-22",
              "value": 123
            },
            {
              "date": "2022-08-12",
              "value": 144
            },
            {
              "date": "2022-04-01",
              "value": 136
            },
            {
              "date": "2022-03-11",
              "value": 138,
              "flag": "H"
            },
            {
              "date": "2018-08-16",
              "value": 119
            },
            {
              "date": "2017-01-28",
              "value": 120
            },
            {
              "date": "2017-01-26",
              "value": 120
            },
            {
              "date": "2015-05-14",
              "value": 121,
              "flag": "H"
            },
            {
              "date": "2013-07-27",
              "value": 135.1
            },
            {
              "date": "2011-09-13",
              "value": 138.4,
              "flag": "H"
            }
          ]
        },
        {
          "marker_en": "VLDL cholesterol",
          "marker_pt": "Colesterol VLDL",
          "unit": "mg/dL",
          "ref_low": null,
          "ref_high": 30.0,
          "ref_text_en": "< 30 mg/dL",
          "ref_text_pt": "< 30 mg/dL",
          "points": [
            {
              "date": "2022-09-22",
              "value": 18
            },
            {
              "date": "2022-08-12",
              "value": 20
            },
            {
              "date": "2022-04-01",
              "value": 19
            },
            {
              "date": "2022-03-11",
              "value": 21
            },
            {
              "date": "2018-08-16",
              "value": 14
            },
            {
              "date": "2015-05-14",
              "value": 17
            },
            {
              "date": "2013-07-27",
              "value": 20.6
            },
            {
              "date": "2011-09-13",
              "value": 21.6
            }
          ]
        },
        {
          "marker_en": "Non-HDL cholesterol",
          "marker_pt": "Colesterol não-HDL",
          "unit": "mg/dL",
          "ref_low": null,
          "ref_high": 160,
          "ref_text_en": "< 160 mg/dL",
          "ref_text_pt": "< 160 mg/dL",
          "points": [
            {
              "date": "2022-09-22",
              "value": 141
            },
            {
              "date": "2022-08-12",
              "value": 165
            },
            {
              "date": "2022-04-01",
              "value": 155
            },
            {
              "date": "2022-03-11",
              "value": 159
            },
            {
              "date": "2017-01-28",
              "value": 136,
              "flag": "H"
            },
            {
              "date": "2017-01-26",
              "value": 136,
              "flag": "H"
            },
            {
              "date": "2013-07-27",
              "value": 156
            }
          ]
        },
        {
          "marker_en": "Triglycerides",
          "marker_pt": "Triglicérides",
          "unit": "mg/dL",
          "ref_low": null,
          "ref_high": 150,
          "ref_text_en": "< 150 mg/dL",
          "ref_text_pt": "< 150 mg/dL",
          "points": [
            {
              "date": "2025-11-12",
              "value": 67
            },
            {
              "date": "2023-02-24",
              "value": 81
            },
            {
              "date": "2022-09-22",
              "value": 82
            },
            {
              "date": "2022-08-12",
              "value": 102.3
            },
            {
              "date": "2022-04-01",
              "value": 93
            },
            {
              "date": "2022-03-11",
              "value": 106
            },
            {
              "date": "2018-08-16",
              "value": 72
            },
            {
              "date": "2017-01-28",
              "value": 79
            },
            {
              "date": "2017-01-26",
              "value": 79
            },
            {
              "date": "2015-05-14",
              "value": 83
            },
            {
              "date": "2013-07-27",
              "value": 102.9
            },
            {
              "date": "2011-09-13",
              "value": 108
            }
          ]
        },
        {
          "marker_en": "Total cholesterol / HDL ratio",
          "marker_pt": "Índice colesterol total/HDL",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Interpretação por faixas de risco (Homem — Baixo Risco: 3,43; Risco Médio: 4,97; Alto Risco: 9,55; Muito Alto Risco: 23,39)",
          "ref_text_pt": "Interpretação por faixas de risco (Homem — Baixo Risco: 3,43; Risco Médio: 4,97; Alto Risco: 9,55; Muito Alto Risco: 23,39)",
          "points": [
            {
              "date": "2011-09-13",
              "value": 3.62
            }
          ]
        },
        {
          "marker_en": "LDL / HDL ratio",
          "marker_pt": "Índice LDL/HDL",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Interpretação por faixas de risco (Homem — Baixo Risco: 1,00; Risco Médio: 3,55; Alto Risco: 6,25; Muito Alto Risco: 7,99)",
          "ref_text_pt": "Interpretação por faixas de risco (Homem — Baixo Risco: 1,00; Risco Médio: 3,55; Alto Risco: 6,25; Muito Alto Risco: 7,99)",
          "points": [
            {
              "date": "2011-09-13",
              "value": 2.27
            }
          ]
        }
      ]
    },
    {
      "slug": "renal",
      "title_en": "Renal function & electrolytes",
      "title_pt": "Função renal e eletrólitos",
      "subtitle_en": "Creatinine, urea, eGFR, uric acid, potassium, magnesium",
      "subtitle_pt": "Creatinina, ureia, eTFG, ácido úrico, potássio, magnésio",
      "markers": [
        {
          "marker_en": "Creatinine",
          "marker_pt": "Creatinina",
          "unit": "mg/dL",
          "ref_low": 0.7,
          "ref_high": 1.2,
          "ref_text_en": "0.7 – 1.2 mg/dL",
          "ref_text_pt": "0,7 – 1,2 mg/dL",
          "points": [
            {
              "date": "2026-07-10",
              "value": 0.8
            },
            {
              "date": "2023-02-24",
              "value": 0.92
            },
            {
              "date": "2022-09-22",
              "value": 1.09
            },
            {
              "date": "2022-03-11",
              "value": 1
            },
            {
              "date": "2018-08-16",
              "value": 0.9
            },
            {
              "date": "2017-01-28",
              "value": 1.06
            },
            {
              "date": "2017-01-26",
              "value": 1.06
            },
            {
              "date": "2015-05-14",
              "value": 0.89
            }
          ]
        },
        {
          "marker_en": "Urea",
          "marker_pt": "Ureia",
          "unit": "mg/dL",
          "ref_low": 16.6,
          "ref_high": 48.5,
          "ref_text_en": "16.6 – 48.5 mg/dL",
          "ref_text_pt": "16,6 – 48,5 mg/dL",
          "points": [
            {
              "date": "2026-07-10",
              "value": 20
            },
            {
              "date": "2022-09-22",
              "value": 21
            },
            {
              "date": "2022-03-11",
              "value": 29
            }
          ]
        },
        {
          "marker_en": "eGFR",
          "marker_pt": "Taxa de filtração glomerular estimada (eTFG)",
          "unit": "mL/min/1.73m²",
          "ref_low": 90,
          "ref_high": null,
          "ref_text_en": "> 90 mL/min/1.73m²",
          "ref_text_pt": "> 90 mL/min/1.73m²",
          "points": [
            {
              "date": "2026-07-10",
              "value_text": ">90 mL/min/1,73m²"
            },
            {
              "date": "2017-01-28",
              "value_text": ">60 ml/min./1.73 m2"
            },
            {
              "date": "2017-01-26",
              "value_text": ">60 ml/min./1.73 m2"
            }
          ]
        },
        {
          "marker_en": "Uric acid",
          "marker_pt": "Ácido úrico",
          "unit": "mg/dL",
          "ref_low": 3.6,
          "ref_high": 8.2,
          "ref_text_en": "3.6 – 8.2 mg/dL",
          "ref_text_pt": "3,6 – 8,2 mg/dL",
          "points": [
            {
              "date": "2022-09-22",
              "value": 5.2
            },
            {
              "date": "2018-08-16",
              "value": 5
            },
            {
              "date": "2017-01-28",
              "value": 4.9
            },
            {
              "date": "2017-01-26",
              "value": 4.9
            },
            {
              "date": "2015-05-14",
              "value": 5.8
            },
            {
              "date": "2014-03-08",
              "value": 4.9
            }
          ]
        },
        {
          "marker_en": "Potassium",
          "marker_pt": "Potássio",
          "unit": "mEq/L",
          "ref_low": 3.5,
          "ref_high": 5.1,
          "ref_text_en": "3.5 – 5.1 mEq/L",
          "ref_text_pt": "3,5 – 5,1 mEq/L",
          "points": [
            {
              "date": "2026-07-10",
              "value": 4.1
            },
            {
              "date": "2022-09-22",
              "value": 4.1
            },
            {
              "date": "2018-08-16",
              "value": 4.1
            },
            {
              "date": "2017-01-28",
              "value": 4.1
            },
            {
              "date": "2017-01-26",
              "value": 4.1
            }
          ]
        },
        {
          "marker_en": "Magnesium",
          "marker_pt": "Magnésio",
          "unit": "mg/dL",
          "ref_low": 1.8,
          "ref_high": 2.6,
          "ref_text_en": "1.8 – 2.6 mg/dL",
          "ref_text_pt": "1,8 – 2,6 mg/dL",
          "points": [
            {
              "date": "2018-08-16",
              "value": 2
            },
            {
              "date": "2017-01-28",
              "value": 2.24
            },
            {
              "date": "2017-01-26",
              "value": 2.24
            }
          ]
        },
        {
          "marker_en": "Sodium",
          "marker_pt": "Sódio",
          "unit": "mEq/L",
          "ref_low": 137,
          "ref_high": 145,
          "ref_text_en": "137 – 145 mEq/L",
          "ref_text_pt": "137 – 145 mEq/L",
          "points": [
            {
              "date": "2026-07-14",
              "value": 129,
              "flag": "L"
            },
            {
              "date": "2026-07-10",
              "value": 126,
              "flag": "L"
            }
          ]
        }
      ]
    },
    {
      "slug": "hepatic",
      "title_en": "Liver function",
      "title_pt": "Função hepática",
      "subtitle_en": "AST, ALT, GGT, bilirubins",
      "subtitle_pt": "TGO, TGP, GGT, bilirrubinas",
      "markers": [
        {
          "marker_en": "AST (TGO)",
          "marker_pt": "AST (TGO)",
          "unit": "U/L",
          "ref_low": 10,
          "ref_high": 50,
          "ref_text_en": "10 – 50 U/L",
          "ref_text_pt": "10 – 50 U/L",
          "points": [
            {
              "date": "2026-07-10",
              "value": 25
            },
            {
              "date": "2022-09-22",
              "value": 20
            },
            {
              "date": "2022-03-11",
              "value": 25
            },
            {
              "date": "2015-05-14",
              "value": 28
            },
            {
              "date": "2013-07-27",
              "value": 16.6
            }
          ]
        },
        {
          "marker_en": "ALT (TGP)",
          "marker_pt": "ALT (TGP)",
          "unit": "U/L",
          "ref_low": 10,
          "ref_high": 50,
          "ref_text_en": "10 – 50 U/L",
          "ref_text_pt": "10 – 50 U/L",
          "points": [
            {
              "date": "2026-07-10",
              "value": 21
            },
            {
              "date": "2022-09-22",
              "value": 20
            },
            {
              "date": "2022-03-11",
              "value": 26
            },
            {
              "date": "2017-01-28",
              "value": 15
            },
            {
              "date": "2017-01-26",
              "value": 15
            },
            {
              "date": "2015-05-14",
              "value": 26
            },
            {
              "date": "2013-07-27",
              "value": 12.4
            }
          ]
        },
        {
          "marker_en": "GGT",
          "marker_pt": "Gama-GT (GGT)",
          "unit": "U/L",
          "ref_low": null,
          "ref_high": 60,
          "ref_text_en": "< 60 U/L",
          "ref_text_pt": "< 60 U/L",
          "points": [
            {
              "date": "2017-01-28",
              "value": 27
            },
            {
              "date": "2017-01-26",
              "value": 27
            },
            {
              "date": "2015-05-14",
              "value": 34
            },
            {
              "date": "2013-07-27",
              "value": 37.4
            }
          ]
        },
        {
          "marker_en": "Total bilirubin",
          "marker_pt": "Bilirrubina total",
          "unit": "mg/dL",
          "ref_low": null,
          "ref_high": 1.2,
          "ref_text_en": "< 1.2 mg/dL",
          "ref_text_pt": "< 1,2 mg/dL",
          "points": [
            {
              "date": "2026-07-10",
              "value": 0.3
            },
            {
              "date": "2013-07-27",
              "value": 0.48
            }
          ]
        },
        {
          "marker_en": "Direct bilirubin",
          "marker_pt": "Bilirrubina direta",
          "unit": "mg/dL",
          "ref_low": null,
          "ref_high": 0.2,
          "ref_text_en": "< 0.2 mg/dL",
          "ref_text_pt": "< 0,2 mg/dL",
          "points": [
            {
              "date": "2026-07-10",
              "value": 0.2
            },
            {
              "date": "2013-07-27",
              "value": 0.2
            }
          ]
        },
        {
          "marker_en": "Indirect bilirubin",
          "marker_pt": "Bilirrubina indireta",
          "unit": "mg/dL",
          "ref_low": null,
          "ref_high": 0.8,
          "ref_text_en": "< 0.8 mg/dL",
          "ref_text_pt": "< 0,8 mg/dL",
          "points": [
            {
              "date": "2026-07-10",
              "value": 0.1
            },
            {
              "date": "2013-07-27",
              "value": 0.28
            }
          ]
        }
      ]
    },
    {
      "slug": "hormones",
      "title_en": "Hormones & thyroid",
      "title_pt": "Hormônios e tireoide",
      "subtitle_en": "TSH, free T4, testosterone, estradiol, SHBG",
      "subtitle_pt": "TSH, T4 livre, testosterona, estradiol, SHBG",
      "markers": [
        {
          "marker_en": "TSH (ultra-sensitive)",
          "marker_pt": "TSH ultra-sensível",
          "unit": "µUI/mL",
          "ref_low": 0.38,
          "ref_high": 5.33,
          "ref_text_en": "0.38 – 5.33 µUI/mL",
          "ref_text_pt": "0,38 – 5,33 µUI/mL",
          "points": [
            {
              "date": "2022-09-22",
              "value": 1.392
            },
            {
              "date": "2018-08-16",
              "value": 1.91
            },
            {
              "date": "2017-01-28",
              "value": 2.1
            },
            {
              "date": "2017-01-26",
              "value": 2.1
            },
            {
              "date": "2015-05-14",
              "value": 1.93
            }
          ]
        },
        {
          "marker_en": "Free T4",
          "marker_pt": "T4 livre",
          "unit": "ng/dL",
          "ref_low": 0.7,
          "ref_high": 1.8,
          "ref_text_en": "0.7 – 1.8 ng/dL",
          "ref_text_pt": "0,7 – 1,8 ng/dL",
          "points": [
            {
              "date": "2015-05-14",
              "value": 1.38
            }
          ]
        },
        {
          "marker_en": "Total testosterone",
          "marker_pt": "Testosterona total",
          "unit": "ng/dL",
          "ref_low": 175.0,
          "ref_high": 781.0,
          "ref_text_en": "175 – 781 ng/dL",
          "ref_text_pt": "175 – 781 ng/dL",
          "points": [
            {
              "date": "2023-02-24",
              "value": 410.53
            },
            {
              "date": "2022-08-12",
              "value": 554.82
            },
            {
              "date": "2022-04-01",
              "value": 662
            },
            {
              "date": "2022-03-11",
              "value": 491.5
            }
          ]
        },
        {
          "marker_en": "Free testosterone",
          "marker_pt": "Testosterona livre",
          "unit": "ng/dL",
          "ref_low": 3.03,
          "ref_high": 14.8,
          "ref_text_en": "3.03 – 14.8 ng/dL",
          "ref_text_pt": "3,03 – 14,8 ng/dL",
          "points": [
            {
              "date": "2022-04-01",
              "value": 12.3
            }
          ]
        },
        {
          "marker_en": "Estradiol",
          "marker_pt": "Estradiol",
          "unit": "pg/mL",
          "ref_low": null,
          "ref_high": 33,
          "ref_text_en": "< 33 pg/mL",
          "ref_text_pt": "< 33 pg/mL",
          "points": [
            {
              "date": "2022-08-12",
              "value": 38,
              "flag": "H"
            },
            {
              "date": "2022-04-01",
              "value": 41.7
            },
            {
              "date": "2022-03-11",
              "value": 25,
              "flag": "L"
            }
          ]
        },
        {
          "marker_en": "SHBG",
          "marker_pt": "SHBG",
          "unit": "nmol/L",
          "ref_low": 14.6,
          "ref_high": 94.6,
          "ref_text_en": "14.6 – 94.6 nmol/L",
          "ref_text_pt": "14,6 – 94,6 nmol/L",
          "points": [
            {
              "date": "2022-04-01",
              "value": 43.4
            },
            {
              "date": "2022-03-11",
              "value": 56.5
            }
          ]
        }
      ]
    },
    {
      "slug": "prostate",
      "title_en": "Prostate (PSA)",
      "title_pt": "Próstata (PSA)",
      "subtitle_en": "Total & free PSA, free/total ratio",
      "subtitle_pt": "PSA total e livre, relação livre/total",
      "markers": [
        {
          "marker_en": "Total PSA",
          "marker_pt": "PSA total",
          "unit": "ng/mL",
          "ref_low": null,
          "ref_high": 2.5,
          "ref_text_en": "< 2.5 ng/mL",
          "ref_text_pt": "< 2,5 ng/mL",
          "points": [
            {
              "date": "2025-11-12",
              "value": 1.218
            },
            {
              "date": "2023-02-22",
              "value": 0.49
            },
            {
              "date": "2022-03-11",
              "value": 0.882
            },
            {
              "date": "2018-08-16",
              "value": 0.91
            },
            {
              "date": "2017-03-11",
              "value": 0.828
            },
            {
              "date": "2015-05-14",
              "value": 0.953
            },
            {
              "date": "2013-07-27",
              "value": 0.71
            }
          ]
        },
        {
          "marker_en": "Free PSA",
          "marker_pt": "PSA livre",
          "unit": "ng/mL",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Não há valores de referência definidos para este exame",
          "ref_text_pt": "Não há valores de referência definidos para este exame",
          "points": [
            {
              "date": "2023-02-22",
              "value": 0.14
            },
            {
              "date": "2013-07-27",
              "value": 0.3
            }
          ]
        },
        {
          "marker_en": "Free/Total PSA ratio",
          "marker_pt": "Relação PSA livre/total",
          "unit": "%",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Relação PSA Livre/Total aplicável em pacientes a partir dos 50 anos com PSA Total entre 4 e 10 ng/mL: <15% maior probabilidade de câncer de próstata; ≥15% maior probabilidade de hiperplasia prostática benigna",
          "ref_text_pt": "Relação PSA Livre/Total aplicável em pacientes a partir dos 50 anos com PSA Total entre 4 e 10 ng/mL: <15% maior probabilidade de câncer de próstata; ≥15% maior probabilidade de hiperplasia prostática benigna",
          "points": [
            {
              "date": "2023-02-22",
              "value": 29
            }
          ]
        }
      ]
    },
    {
      "slug": "inflammatory",
      "title_en": "Cardiac & inflammatory markers",
      "title_pt": "Marcadores cardíacos e inflamatórios",
      "subtitle_en": "CRP, ESR, CK-MB, troponin I, NT-proBNP",
      "subtitle_pt": "PCR, VHS, CK-MB, troponina I, NT-proBNP",
      "markers": [
        {
          "marker_en": "ESR (sedimentation rate)",
          "marker_pt": "VHS (hemossedimentação)",
          "unit": "mm/h",
          "ref_low": null,
          "ref_high": 15.0,
          "ref_text_en": "< 15 mm/h",
          "ref_text_pt": "< 15 mm/h",
          "points": [
            {
              "date": "2019-02-08",
              "value": 25,
              "flag": "H"
            }
          ]
        },
        {
          "marker_en": "C-reactive protein (CRP)",
          "marker_pt": "Proteína C reativa (PCR)",
          "unit": "mg/L",
          "ref_low": null,
          "ref_high": 5.0,
          "ref_text_en": "< 5 mg/L",
          "ref_text_pt": "< 5 mg/L",
          "points": [
            {
              "date": "2026-07-10",
              "value": 3
            },
            {
              "date": "2019-03-05",
              "value": 4.9
            },
            {
              "date": "2019-02-08",
              "value_text": "Inferior a 6 mg/L"
            },
            {
              "date": "2015-05-14",
              "value": 0.22
            }
          ]
        },
        {
          "marker_en": "CK-MB",
          "marker_pt": "CK-MB",
          "unit": "U/L",
          "ref_low": 0,
          "ref_high": 24,
          "ref_text_en": "0 – 24 U/L",
          "ref_text_pt": "0 – 24 U/L",
          "points": [
            {
              "date": "2019-03-05",
              "value": 14
            }
          ]
        },
        {
          "marker_en": "Troponin I",
          "marker_pt": "Troponina I",
          "unit": "ng/mL",
          "ref_low": 0.03,
          "ref_high": 0.08,
          "ref_text_en": "0.03 – 0.08 ng/mL",
          "ref_text_pt": "0,03 – 0,08 ng/mL",
          "points": [
            {
              "date": "2019-03-05",
              "value_text": "< 0,03"
            }
          ]
        },
        {
          "marker_en": "NT-proBNP",
          "marker_pt": "NT-proBNP",
          "unit": "pg/mL",
          "ref_low": null,
          "ref_high": 125.0,
          "ref_text_en": "< 125 pg/mL",
          "ref_text_pt": "< 125 pg/mL",
          "points": [
            {
              "date": "2026-07-10",
              "value": 205,
              "flag": "H"
            }
          ]
        }
      ]
    },
    {
      "slug": "coagulation",
      "title_en": "Coagulation",
      "title_pt": "Coagulograma",
      "subtitle_en": "Prothrombin time / INR, aPTT",
      "subtitle_pt": "Tempo de protrombina / INR, TTPA",
      "markers": [
        {
          "marker_en": "Prothrombin time",
          "marker_pt": "Tempo de protrombina (TP)",
          "unit": "s",
          "ref_low": 9.8,
          "ref_high": 12.7,
          "ref_text_en": "9.8 – 12.7 s",
          "ref_text_pt": "9,8 – 12,7 s",
          "points": [
            {
              "date": "2026-07-10",
              "value": 9.9
            },
            {
              "date": "2018-08-16",
              "value": 11.1
            },
            {
              "date": "2013-07-27",
              "value": 0.84
            }
          ]
        },
        {
          "marker_en": "INR",
          "marker_pt": "INR",
          "unit": "",
          "ref_low": 0.86,
          "ref_high": 1.2,
          "ref_text_en": "0.86 – 1.2",
          "ref_text_pt": "0,86 – 1,2",
          "points": [
            {
              "date": "2026-07-10",
              "value": 0.9
            },
            {
              "date": "2018-08-16",
              "value": 0.94
            }
          ]
        },
        {
          "marker_en": "Prothrombin activity",
          "marker_pt": "Atividade de protrombina",
          "unit": "%",
          "ref_low": 70,
          "ref_high": 130,
          "ref_text_en": "70 – 130 %",
          "ref_text_pt": "70 – 130 %",
          "points": [
            {
              "date": "2026-07-10",
              "value": 106
            },
            {
              "date": "2018-08-16",
              "value": 100
            }
          ]
        },
        {
          "marker_en": "aPTT",
          "marker_pt": "TTPA",
          "unit": "s",
          "ref_low": null,
          "ref_high": 37.3,
          "ref_text_en": "< 37.3 s",
          "ref_text_pt": "< 37,3 s",
          "points": [
            {
              "date": "2026-07-10",
              "value": 24.6
            },
            {
              "date": "2018-08-16",
              "value": 28.9
            },
            {
              "date": "2013-07-27",
              "value": 30.8
            }
          ]
        },
        {
          "marker_en": "aPTT ratio (R)",
          "marker_pt": "Relação TTPA (R)",
          "unit": "",
          "ref_low": 0.9,
          "ref_high": 1.37,
          "ref_text_en": "0.9 – 1.37",
          "ref_text_pt": "0,9 – 1,37",
          "points": [
            {
              "date": "2018-08-16",
              "value": 1.03
            }
          ]
        }
      ]
    },
    {
      "slug": "vitamins",
      "title_en": "Vitamins & iron",
      "title_pt": "Vitaminas e ferro",
      "subtitle_en": "Vitamin D, B12, homocysteine, ferritin",
      "subtitle_pt": "Vitamina D, B12, homocisteína, ferritina",
      "markers": [
        {
          "marker_en": "Vitamin D (25-OH)",
          "marker_pt": "Vitamina D (25-OH)",
          "unit": "ng/mL",
          "ref_low": 30.0,
          "ref_high": null,
          "ref_text_en": "> 30 ng/mL",
          "ref_text_pt": "> 30 ng/mL",
          "points": [
            {
              "date": "2025-11-12",
              "value": 22.2,
              "flag": "L"
            },
            {
              "date": "2022-09-22",
              "value": 16.4,
              "flag": "L"
            },
            {
              "date": "2015-05-14",
              "value": 25.1
            }
          ]
        },
        {
          "marker_en": "Vitamin B12",
          "marker_pt": "Vitamina B12",
          "unit": "pg/mL",
          "ref_low": 187,
          "ref_high": 883,
          "ref_text_en": "187 – 883 pg/mL",
          "ref_text_pt": "187 – 883 pg/mL",
          "points": [
            {
              "date": "2025-11-12",
              "value": 504
            },
            {
              "date": "2015-05-14",
              "value": 458
            }
          ]
        },
        {
          "marker_en": "Homocysteine",
          "marker_pt": "Homocisteína",
          "unit": "µmol/L",
          "ref_low": 5.0,
          "ref_high": 12.0,
          "ref_text_en": "5 – 12 µmol/L",
          "ref_text_pt": "5 – 12 µmol/L",
          "points": [
            {
              "date": "2015-05-14",
              "value": 8.2
            }
          ]
        },
        {
          "marker_en": "Ferritin",
          "marker_pt": "Ferritina",
          "unit": "ng/mL",
          "ref_low": 23.9,
          "ref_high": 336.2,
          "ref_text_en": "23.9 – 336.2 ng/mL",
          "ref_text_pt": "23,9 – 336,2 ng/mL",
          "points": [
            {
              "date": "2018-08-16",
              "value": 259.2
            },
            {
              "date": "2017-01-28",
              "value": 346.2
            },
            {
              "date": "2017-01-26",
              "value": 346.2
            },
            {
              "date": "2015-05-14",
              "value": 379,
              "flag": "H"
            }
          ]
        }
      ]
    },
    {
      "slug": "serology",
      "title_en": "Serologies",
      "title_pt": "Sorologias",
      "subtitle_en": "Hepatitis B/C, dengue, COVID-19",
      "subtitle_pt": "Hepatites B/C, dengue, COVID-19",
      "markers": [
        {
          "marker_en": "HBsAg (hepatitis B surface antigen)",
          "marker_pt": "HBsAg (antígeno de superfície hepatite B)",
          "unit": "",
          "ref_low": null,
          "ref_high": 0.9,
          "ref_text_en": "< 0.9",
          "ref_text_pt": "< 0,9",
          "points": [
            {
              "date": "2015-05-14",
              "value": 0.46
            }
          ]
        },
        {
          "marker_en": "Anti-HBs",
          "marker_pt": "Anti-HBs",
          "unit": "UI/L",
          "ref_low": 10,
          "ref_high": null,
          "ref_text_en": "> 10 UI/L",
          "ref_text_pt": "> 10 UI/L",
          "points": [
            {
              "date": "2015-05-14",
              "value_text": "Inferior a 2 UI/L",
              "flag": "L"
            }
          ]
        },
        {
          "marker_en": "HBeAg",
          "marker_pt": "HBeAg",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Não Reagente",
          "ref_text_pt": "Não Reagente",
          "points": [
            {
              "date": "2015-05-14",
              "value_text": "Não Reagente"
            }
          ]
        },
        {
          "marker_en": "Anti-HBe",
          "marker_pt": "Anti-HBe",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Não Reagente",
          "ref_text_pt": "Não Reagente",
          "points": [
            {
              "date": "2015-05-14",
              "value_text": "Não Reagente"
            }
          ]
        },
        {
          "marker_en": "Anti-HBc (total/IgM)",
          "marker_pt": "Anti-HBc (total/IgM)",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Não Reagente",
          "ref_text_pt": "Não Reagente",
          "points": [
            {
              "date": "2015-05-14",
              "value_text": "Não Reagente"
            }
          ]
        },
        {
          "marker_en": "Anti-HCV",
          "marker_pt": "Anti-HCV",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Não Reagente",
          "ref_text_pt": "Não Reagente",
          "points": [
            {
              "date": "2015-05-14",
              "value_text": "Não Reagente"
            }
          ]
        },
        {
          "marker_en": "Dengue NS1 antigen",
          "marker_pt": "Dengue NS1",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Não Reagente",
          "ref_text_pt": "Não Reagente",
          "points": [
            {
              "date": "2024-04-15",
              "value_text": "Não Reagente"
            }
          ]
        },
        {
          "marker_en": "COVID-19 rapid antigen",
          "marker_pt": "Antígeno rápido COVID-19",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Negativo",
          "ref_text_pt": "Negativo",
          "points": [
            {
              "date": "2024-04-15",
              "value_text": "Negativo"
            }
          ]
        }
      ]
    },
    {
      "slug": "urinalysis",
      "title_en": "Urinalysis (type I / EAS)",
      "title_pt": "Urina tipo I (EAS)",
      "subtitle_en": "Physical, chemical & microscopic sediment",
      "subtitle_pt": "Físico, químico e sedimento microscópico",
      "markers": [
        {
          "marker_en": "Urine color",
          "marker_pt": "Cor",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Não se aplica",
          "ref_text_pt": "Não se aplica",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Amarelo citrino"
            },
            {
              "date": "2023-02-24",
              "value_text": "AMARELO CLARO"
            },
            {
              "date": "2022-03-11",
              "value_text": "Amarelo Citrino"
            },
            {
              "date": "2018-10-16",
              "value_text": "AMARELO PALHA"
            },
            {
              "date": "2017-03-11",
              "value_text": "Amarelo claro"
            },
            {
              "date": "2015-05-14",
              "value_text": "Amarelo Citrino"
            }
          ]
        },
        {
          "marker_en": "Urine appearance",
          "marker_pt": "Aspecto",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Claro",
          "ref_text_pt": "Claro",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Opalescente"
            },
            {
              "date": "2023-02-24",
              "value_text": "LÍMPIDO"
            },
            {
              "date": "2022-03-11",
              "value_text": "Opalescente"
            },
            {
              "date": "2018-10-16",
              "value_text": "LÍMPIDA"
            }
          ]
        },
        {
          "marker_en": "Specific gravity",
          "marker_pt": "Densidade",
          "unit": "",
          "ref_low": 1.01,
          "ref_high": 1.03,
          "ref_text_en": "1.01 – 1.03",
          "ref_text_pt": "1,01 – 1,03",
          "points": [
            {
              "date": "2025-11-12",
              "value": 1.009,
              "flag": "L"
            },
            {
              "date": "2023-02-24",
              "value": 1005,
              "flag": "L"
            },
            {
              "date": "2022-03-11",
              "value": 1010
            },
            {
              "date": "2018-10-16",
              "value": 1.01,
              "flag": "L"
            },
            {
              "date": "2017-03-11",
              "value": 1.01
            },
            {
              "date": "2015-05-14",
              "value": 1.008
            }
          ]
        },
        {
          "marker_en": "pH",
          "marker_pt": "pH",
          "unit": "",
          "ref_low": 4.5,
          "ref_high": 7.5,
          "ref_text_en": "4.5 – 7.5",
          "ref_text_pt": "4,5 – 7,5",
          "points": [
            {
              "date": "2025-11-12",
              "value": 7
            },
            {
              "date": "2023-02-24",
              "value": 8,
              "flag": "H"
            },
            {
              "date": "2022-03-11",
              "value": 6
            },
            {
              "date": "2018-10-16",
              "value": 6
            },
            {
              "date": "2017-03-11",
              "value": 7.5,
              "flag": "H"
            },
            {
              "date": "2015-05-14",
              "value": 7
            }
          ]
        },
        {
          "marker_en": "Volume",
          "marker_pt": "Volume",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": null,
          "ref_text_pt": null,
          "points": [
            {
              "date": "2023-02-24",
              "value": 50
            }
          ]
        },
        {
          "marker_en": "Reaction",
          "marker_pt": "Reação",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "ACIDA",
          "ref_text_pt": "ACIDA",
          "points": [
            {
              "date": "2018-10-16",
              "value_text": "ÁCIDA"
            }
          ]
        },
        {
          "marker_en": "Deposit",
          "marker_pt": "Depósito",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Leve",
          "ref_text_pt": "Leve",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Leve"
            },
            {
              "date": "2022-03-11",
              "value_text": "Leve"
            },
            {
              "date": "2018-10-16",
              "value_text": "AUSENTES"
            }
          ]
        },
        {
          "marker_en": "Protein",
          "marker_pt": "Proteínas",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Inferior a 30 mg/dL",
          "ref_text_pt": "Inferior a 30 mg/dL",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Negativo"
            },
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2022-03-11",
              "value_text": "Negativo"
            },
            {
              "date": "2018-10-16",
              "value_text": "NEGATIVO"
            },
            {
              "date": "2017-03-11",
              "value_text": "Negativo"
            },
            {
              "date": "2015-05-14",
              "value_text": "Negativo"
            }
          ]
        },
        {
          "marker_en": "Glucose (urine)",
          "marker_pt": "Glicose (urina)",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Negativo",
          "ref_text_pt": "Negativo",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Negativo"
            },
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2022-03-11",
              "value_text": "Negativo"
            },
            {
              "date": "2018-10-16",
              "value_text": "NEGATIVO"
            },
            {
              "date": "2017-03-11",
              "value_text": "Negativo"
            },
            {
              "date": "2015-05-14",
              "value_text": "Negativo"
            }
          ]
        },
        {
          "marker_en": "Ketone bodies",
          "marker_pt": "Corpos cetônicos",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Negativo",
          "ref_text_pt": "Negativo",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Negativo"
            },
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2022-03-11",
              "value_text": "Negativo"
            },
            {
              "date": "2018-10-16",
              "value_text": "AUSENTES"
            },
            {
              "date": "2017-03-11",
              "value_text": "Negativo"
            },
            {
              "date": "2015-05-14",
              "value_text": "Negativo"
            }
          ]
        },
        {
          "marker_en": "Bile pigments / bilirubin",
          "marker_pt": "Pigmentos biliares / bilirrubina",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Negativo",
          "ref_text_pt": "Negativo",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Negativo"
            },
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2022-03-11",
              "value_text": "Negativo"
            },
            {
              "date": "2018-10-16",
              "value_text": "AUSENTES"
            },
            {
              "date": "2017-03-11",
              "value_text": "Negativo"
            },
            {
              "date": "2015-05-14",
              "value_text": "Negativo"
            }
          ]
        },
        {
          "marker_en": "Urobilinogen",
          "marker_pt": "Urobilinogênio",
          "unit": "",
          "ref_low": null,
          "ref_high": 0.6,
          "ref_text_en": "< 0.6",
          "ref_text_pt": "< 0,6",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Negativo"
            },
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2022-03-11",
              "value_text": "Normal"
            },
            {
              "date": "2017-03-11",
              "value": 0.2
            },
            {
              "date": "2015-05-14",
              "value": 0.2
            }
          ]
        },
        {
          "marker_en": "Blood / hemoglobin",
          "marker_pt": "Sangue / hemoglobina",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Ausente",
          "ref_text_pt": "Ausente",
          "points": [
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2017-03-11",
              "value_text": "Negativo"
            },
            {
              "date": "2015-05-14",
              "value_text": "Negativo"
            }
          ]
        },
        {
          "marker_en": "Nitrite",
          "marker_pt": "Nitrito",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Negativo",
          "ref_text_pt": "Negativo",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Negativo"
            },
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2022-03-11",
              "value_text": "Negativo"
            },
            {
              "date": "2018-10-16",
              "value_text": "AUSENTES"
            },
            {
              "date": "2017-03-11",
              "value_text": "Negativo"
            },
            {
              "date": "2015-05-14",
              "value_text": "Negativo"
            }
          ]
        },
        {
          "marker_en": "Leukocytes (sediment)",
          "marker_pt": "Leucócitos (sedimento)",
          "unit": "",
          "ref_low": null,
          "ref_high": 7000,
          "ref_text_en": "< 7000",
          "ref_text_pt": "< 7000",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "0,7 /µL"
            },
            {
              "date": "2023-02-24",
              "value": 25
            },
            {
              "date": "2022-03-11",
              "value": 2000
            },
            {
              "date": "2018-10-16",
              "value": 1000
            },
            {
              "date": "2017-03-11",
              "value_text": "1 a 2 p/c isolados"
            },
            {
              "date": "2015-05-14",
              "value": 300
            }
          ]
        },
        {
          "marker_en": "Erythrocytes (sediment)",
          "marker_pt": "Hemácias (sedimento)",
          "unit": "",
          "ref_low": null,
          "ref_high": 5000,
          "ref_text_en": "< 5000",
          "ref_text_pt": "< 5000",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "1 /µL"
            },
            {
              "date": "2023-02-24",
              "value": 0
            },
            {
              "date": "2022-03-11",
              "value": 1000
            },
            {
              "date": "2018-10-16",
              "value": 2000
            },
            {
              "date": "2017-03-11",
              "value_text": "0 a 1 p/c"
            },
            {
              "date": "2015-05-14",
              "value": 500
            }
          ]
        },
        {
          "marker_en": "Epithelial cells",
          "marker_pt": "Células epiteliais",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Raras",
          "ref_text_pt": "Raras",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Ausentes"
            },
            {
              "date": "2023-02-24",
              "value_text": "RARAS"
            },
            {
              "date": "2022-03-11",
              "value_text": "Raros"
            },
            {
              "date": "2018-10-16",
              "value_text": "RARAS"
            },
            {
              "date": "2017-03-11",
              "value_text": "Raras"
            }
          ]
        },
        {
          "marker_en": "Casts",
          "marker_pt": "Cilindros",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Inferior a 1 /µL",
          "ref_text_pt": "Inferior a 1 /µL",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "0 /µL"
            },
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2022-03-11",
              "value_text": "Ausentes"
            },
            {
              "date": "2018-10-16",
              "value_text": "AUSENTES"
            },
            {
              "date": "2017-03-11",
              "value_text": "Ausente"
            }
          ]
        },
        {
          "marker_en": "Crystals",
          "marker_pt": "Cristais",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Ausentes",
          "ref_text_pt": "Ausentes",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Ausentes"
            },
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2022-03-11",
              "value_text": "Ausentes"
            },
            {
              "date": "2018-10-16",
              "value_text": "AUSENTES"
            },
            {
              "date": "2017-03-11",
              "value_text": "Ausente"
            }
          ]
        },
        {
          "marker_en": "Bacteria",
          "marker_pt": "Bactérias",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Ausentes",
          "ref_text_pt": "Ausentes",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Ausentes"
            },
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2022-03-11",
              "value_text": "Ausentes"
            }
          ]
        },
        {
          "marker_en": "Mucus threads",
          "marker_pt": "Filamentos de muco",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Raros",
          "ref_text_pt": "Raros",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Raros"
            },
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2022-03-11",
              "value_text": "Raros"
            },
            {
              "date": "2018-10-16",
              "value_text": "AUSENTES"
            },
            {
              "date": "2017-03-11",
              "value_text": "Ausente"
            }
          ]
        },
        {
          "marker_en": "Yeasts",
          "marker_pt": "Leveduras",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Ausentes",
          "ref_text_pt": "Ausentes",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Ausentes"
            },
            {
              "date": "2023-02-24",
              "value_text": "AUSENTE"
            },
            {
              "date": "2022-03-11",
              "value_text": "Ausentes"
            }
          ]
        },
        {
          "marker_en": "Protozoa",
          "marker_pt": "Protozoários",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Ausentes",
          "ref_text_pt": "Ausentes",
          "points": [
            {
              "date": "2025-11-12",
              "value_text": "Ausentes"
            },
            {
              "date": "2022-03-11",
              "value_text": "Ausentes"
            }
          ]
        },
        {
          "marker_en": "Urine culture",
          "marker_pt": "Urocultura",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": null,
          "ref_text_pt": null,
          "points": [
            {
              "date": "2022-03-11",
              "value_text": "Não houve proliferação de microrganismos."
            }
          ]
        }
      ]
    },
    {
      "slug": "bloodtype",
      "title_en": "Blood type (ABO / Rh)",
      "title_pt": "Tipagem sanguínea (ABO / Rh)",
      "subtitle_en": "ABO group & Rh(D) factor",
      "subtitle_pt": "Grupo ABO e fator Rh(D)",
      "markers": [
        {
          "marker_en": "ABO blood group",
          "marker_pt": "Grupo sanguíneo ABO",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Não se aplica",
          "ref_text_pt": "Não se aplica",
          "points": [
            {
              "date": "2026-04-16",
              "value_text": "O"
            }
          ]
        },
        {
          "marker_en": "Rh factor (RhD)",
          "marker_pt": "Fator Rh (RhD)",
          "unit": "",
          "ref_low": null,
          "ref_high": null,
          "ref_text_en": "Não se aplica",
          "ref_text_pt": "Não se aplica",
          "points": [
            {
              "date": "2026-04-16",
              "value_text": "Positivo"
            }
          ]
        }
      ]
    }
  ]
};
