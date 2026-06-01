# ARMOR GPT Knowledge Files

This folder contains the ARMOR GPT knowledge artifacts provided for the app.

Files found during P0 source-authority work:

- `02_FAR_Competition_and_Sealed_Bidding.txt`
- `DoD_Class_Deviations_FY26v04_dated_2Feb2026.pdf`
- `master_index.json`
- `part_lookup.json`
- `REF_1_Citation_Decision_Tree.txt`
- `REF_3_RFO_Conventions.txt`

P0 status:

- `master_index.json` is loaded as the approved source registry.
- `part_lookup.json` is loaded to begin manifest-backed source routing.
- The text files are approved knowledge artifacts, but they are not yet vector indexed.
- The DoD class-deviation PDF is present, but PDF text retrieval has not yet been implemented. Until it is converted/indexed, class-deviation currency must be marked UTR when no approved deviation text is retrieved.
