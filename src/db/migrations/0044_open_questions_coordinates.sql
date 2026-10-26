-- Open questions are coordinates now; the old rewritten text can't be mapped back to the words.
UPDATE "conversation_state" SET "open_questions" = '[]'::jsonb;
