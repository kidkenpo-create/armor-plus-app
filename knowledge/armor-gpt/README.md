# ARMOR GPT Knowledge Files

This folder contains the ARMOR GPT knowledge artifacts provided for the app.

Files found during P0 source-authority work:

- `02_FAR_Competition_and_Sealed_Bidding.txt`
- `master_index.json`
- `part_lookup.json`
- `REF_1_Citation_Decision_Tree.txt`
- `REF_3_RFO_Conventions.txt`
- `pdf-text/DoD_Class_Deviations_FY26v04_dated_2Feb2026.txt`

Public citation artifacts:

- `public/knowledge/armor-gpt/DoD_Class_Deviations_FY26v04_dated_2Feb2026.pdf`

P0 status:

- `master_index.json` is loaded as the approved source registry.
- `part_lookup.json` is loaded to begin manifest-backed source routing.
- The text files are approved knowledge artifacts, but they are not yet vector indexed.
- The DoD class-deviation PDF is served from `public/` as the official browser-accessible citation artifact.
- The DoD class-deviation text mirror remains internal under `knowledge/armor-gpt/pdf-text/` and is used only through explicit approved `textPath` mappings.
- PDF text retrieval is not inferred at runtime. Class-deviation currency must be marked UTR when no approved deviation text mirror is mapped and retrieved.
