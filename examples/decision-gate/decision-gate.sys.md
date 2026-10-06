# decision-gate — system

A typed decision inside an agent lane: the question, its probability, whose word it is, the band that follows, and the record that later calibrates the thresholds. Drawn from the two Jev reviews (b02ec47d, 80f50d5b) and a real lane on 2026-09-28.

## machine: decision_gate.smdf.json — DecisionGate

```mermaid
stateDiagram-v2
    [*] --> Asked
    Asked --> Scoring : EvidenceAttached
    Scoring --> AwaitingOwner : Scored [relation.word_owner != 'lane' and decision.ruling_id is None]
    Scoring --> Acting : Scored [decision.p >= policy.act_at]
    Scoring --> Blocked : Scored [decision.p <= policy.block_at]
    Scoring --> AwaitingOwner : Scored
    AwaitingOwner --> Acting : OwnerRuled [ruling.verdict == 'act']
    AwaitingOwner --> Blocked : OwnerRuled
    Acting --> Recorded : ActionCompleted
    Blocked --> Recorded : ReasonFedBack
    Recorded --> [*]
```

## erd: decision_record.erdf.json — decision_record

```mermaid
erDiagram
    Question ||--o{ Decision : "answered by"
    Relation ||--o{ Decision : "answers to"
    ThresholdPolicy ||--o{ Decision : "bands"
    Decision ||--o{ Evidence : "read from"
    Decision ||--|| Ruling : "ruled by"
    Ruling }o--o{ ThresholdPolicy : "calibrates"
    Question {
        string id PK
        enum(choice_score_noul_tandt) kind "tandt: a Digital Decision Making model, one acceptable/unacceptable element per row ranked by dominance; the first unacceptable element makes the answer no (llms-digital-decision-making.md)."
        string text "The statement (noul), the instruction (choice, score), or the model name (tandt)."
        json options "Choice options, Score scale, or TandT elements with their dominance."
        string subject_ref "What it is about: a tool call, a commit, a message, an episode, an issue."
        string criteria_ref "The acceptance line, chart action step or issue the answer is checked against. Without it, 'is it done' was measured 83.3% unclassifiable (Miadi worker-stopped route)."
    }
    Relation {
        string id PK
        string word_owner "A named person, or 'lane' when the decision is the lane's own (the reversible tail of work already asked for)."
        string[] accountable_to "The people and relations the outcome answers to."
        boolean reversible
        boolean outward_facing
        string does_not_authorize "The boundary of the authority claimed (community-choice.spec.md)."
    }
    ThresholdPolicy {
        string id PK
        string question_class "The kind of question it governs, e.g. 'tool.before destructive', 'work finished against criteria'."
        number act_at
        number block_at
        string set_by "The person who set the thresholds. A threshold is a choice someone made, named as such (medicine-wheel#155)."
        integer calibrated_from "How many rulings the current values were checked against. Calibration holds over many decisions, never one."
    }
    Decision {
        string id PK
        string question_id FK
        string relation_id FK
        string policy_id FK
        number p "The probability (noul), top option probability (choice) or value (score). Null when unread."
        string p_measures "What the number measures, in words. A number is named for what it measures, never for a value it stands in for."
        enum(satisfied_unsatisfied_unauthorized_unknown) read_status "unknown when the evidence was never read; it never counts as a pass (medicine-wheel infra preconditions.ts)."
        enum(act_ask_block_owner) band "owner: the relational gate sent it to the word-owner before any threshold applied."
        string state "stateOf DecisionGate"
        string decider "The model and version that scored it (Jev, a local classifier, a small model)."
        string ruling_id FK
        string session_id
        string episode
    }
    Evidence {
        string decision_id PK, FK
        enum(transcript_line_commit_test_output_capture_review_issue) kind
        string ref PK "A path with line, a commit hash, a URL. Something a person can open."
    }
    Ruling {
        string id PK
        string decided_by "A named person. Never a computed transition (council-record.spec.md §3.2)."
        string words "What the person said, verbatim. Never edited."
        string reading "What an agent made of the words. Kept apart so a wrong reading can be corrected without touching what was said."
        enum(question_box_typed_spoken_transcribed_circle_turn) source "spoken_transcribed carries the risk of words the transcription added (Episode staging circle, 2026-10-05)."
        enum(act_hold_deepen_return_defer_no) verdict "Wider than pass or fail, after community-review outcomes."
        datetime at
    }
```

## sequence: hedged_message.sqdf.json — hedged_message

```mermaid
sequenceDiagram
  actor p1 as William
  actor p2 as Lane
  actor p3 as Decider
  actor p4 as Witness
  actor p5 as Chronicle
  p1->>p2: 1 "we should talk about it a little bit, except if it obviously makes sense"
  p2->>p3: 2 Noul: this message authorises changing the live notation · EvidenceAttached
  p3-->>p2: 3 p = 0.4, and the word is William's · Scored
  p2->>p4: 4 Choice: deploy / build on a branch / talk first, with evidence
  p4->>p1: 5 three options, and what the lane does meanwhile
  alt William says talk first
    p1->>p4: f1.1 let's talk about it first
    p4->>p2: f1.2 ruling: talk first, by William, with its time · OwnerRuled
    p2->>p5: f1.3 reason recorded, live notation unchanged · ReasonFedBack
  else as written
    p1->>p4: 6 build it on a branch
    p4->>p2: 7 ruling: branch, by William, with its time · OwnerRuled
    p2->>p5: 8 decision record: question, p, band, ruling, evidence · ActionCompleted
  end

```
