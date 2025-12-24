-- ============================================================================
-- Demo Organization & Seed Data
-- ============================================================================
-- Creates a dedicated demo organization with 500+ realistic sample calls
-- for the public demo at callscript.io/demo
--
-- Demo Org ID: 00000000-0000-0000-0000-000000000002
-- ============================================================================

-- 1. Create demo organization
INSERT INTO core.organizations (id, name, slug, plan, is_active, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Demo Company',
  'demo',
  'pro',
  true,
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  is_active = true;

-- 2. Create demo campaigns (5 campaigns across verticals)
INSERT INTO core.campaigns (id, org_id, ringba_campaign_id, name, vertical, is_verified, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000002', 'RC_DEMO_ACA_MAIN', 'ACA Health Plans', 'ACA', true, NOW()),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000002', 'RC_DEMO_ACA_OPEN', 'ACA Open Enrollment', 'ACA', true, NOW()),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000002', 'RC_DEMO_AUTO', 'Auto Insurance Quotes', 'Auto', true, NOW()),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000002', 'RC_DEMO_SOLAR', 'Solar Energy Leads', 'Solar', true, NOW()),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000002', 'RC_DEMO_HOME', 'Home Services', 'General', true, NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  vertical = EXCLUDED.vertical;

-- 3. Generate 500 demo calls using a DO block
DO $$
DECLARE
  demo_org_id UUID := '00000000-0000-0000-0000-000000000002';
  campaign_ids UUID[] := ARRAY[
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000105'
  ];
  publisher_names TEXT[] := ARRAY[
    'LeadStream Media',
    'CallForce Direct',
    'ACA Alliance Network',
    'Digital Leads Pro',
    'Premier Call Partners',
    'National Lead Source',
    'Direct Response Media',
    'Conversion Kings'
  ];
  buyer_names TEXT[] := ARRAY[
    'United Health Partners',
    'Auto Shield Insurance',
    'SunPower Solar Co',
    'HomeGuard Services'
  ];
  states TEXT[] := ARRAY[
    'FL', 'CA', 'TX', 'NY', 'PA', 'IL', 'OH', 'GA', 'NC', 'MI',
    'NJ', 'VA', 'WA', 'AZ', 'MA', 'TN', 'IN', 'MO', 'MD', 'WI'
  ];
  flagged_transcripts TEXT[] := ARRAY[
    'Agent: Thank you for calling. I see you are interested in health insurance. Let me help you today. Customer: Yes I need coverage. Agent: Great, I can definitely help. Now before we continue, I need to let you know this call may be recorded. Customer: Okay thats fine. Agent: Perfect. So tell me about your current situation. Do you have any pre-existing conditions? Customer: Well I have diabetes. Agent: I understand. Now I am going to transfer you to one of our licensed agents who can help you find the best plan. Customer: Okay sounds good. Agent: One moment please.',
    'Agent: Hello this is insurance services how can I help you today? Customer: Hi I am looking for car insurance. Agent: Wonderful I can help with that. First let me get some information from you. What is your zip code? Customer: 33021. Agent: Great and what year is your vehicle? Customer: 2019 Honda Accord. Agent: Perfect. Now I am going to give you a quote but first I need to verify you are over 18. Customer: Yes I am 45. Agent: Great. Based on what you told me your monthly premium would be around 89 dollars. Does that work for you? Customer: That sounds good. Agent: Excellent let me transfer you to complete the enrollment.',
    'Agent: Welcome to solar solutions. Customer: Hi I got a call about solar panels. Agent: Yes we have a special promotion right now. You can save up to 50 percent on your electric bill. Customer: That sounds too good to be true. Agent: I assure you it is legitimate. We are partnered with the government rebate program. Customer: What government program? Agent: The federal solar incentive. You qualify for a free installation. Customer: Free? Agent: Yes absolutely free with no money down. Let me schedule someone to come out. Customer: I dont know this seems pushy.',
    'Agent: Thank you for calling Medicare services. Customer: Hi I need help with my coverage. Agent: Of course. Are you currently on Medicare? Customer: Yes Part A and B. Agent: Perfect. I can help you find a better plan. What is your date of birth? Customer: January 15 1955. Agent: Great. And your zip code? Customer: 85032. Agent: I see several options available. The best one would save you money every month. Customer: How much? Agent: Let me check. It looks like you could save 150 dollars. Customer: That would be great. Agent: I just need your Medicare number to proceed.',
    'Agent: Insurance hotline how may I direct your call? Customer: I want to cancel my policy. Agent: I understand. Before I transfer you can I ask why you want to cancel? Customer: The rates are too high. Agent: I see. What if I could get you a better rate? Customer: I already tried that. Agent: Let me check one more time. I see here we have a loyalty discount available. Customer: No I just want to cancel. Agent: Sir I really think you should reconsider. Customer: No transfer me now. Agent: Okay but you will lose all your benefits. Customer: I dont care just cancel it.'
  ];
  safe_transcripts TEXT[] := ARRAY[
    'Agent: Thank you for calling ACA Health Plans. This call may be recorded for quality assurance. How can I help you today? Customer: Hi I am looking for health insurance for my family. Agent: I would be happy to help you with that. Let me ask a few questions to find the best plan for your needs. What state do you live in? Customer: I live in Florida. Agent: Great. And how many people need coverage? Customer: Myself my wife and two children. Agent: Perfect. Are you currently employed? Customer: Yes I work full time. Agent: Wonderful. Based on your situation you may qualify for subsidies. Let me transfer you to a licensed agent who can go over all your options. Customer: Thank you so much. Agent: You are welcome. Have a great day.',
    'Agent: Good afternoon this is Auto Shield Insurance. My name is Sarah. How can I assist you? Customer: Hi Sarah I need to add a vehicle to my policy. Agent: Of course I can help with that. May I have your policy number? Customer: Its 12345678. Agent: Thank you. I see your account. What vehicle would you like to add? Customer: A 2022 Toyota Camry. Agent: Great choice. And what is the VIN number? Customer: Let me get that. Its 1HGBH41JXMN109186. Agent: Perfect. Your new premium with this vehicle would be 145 per month. Customer: That works for me. Agent: Excellent. The change is effective immediately. Is there anything else? Customer: No thats all. Thank you. Agent: Thank you for choosing Auto Shield. Have a wonderful day.',
    'Agent: SunPower Solar this is Mike speaking. Customer: Hi Mike I received information about solar panels for my home. Agent: Yes I would be happy to tell you more. Solar can significantly reduce your electricity costs. May I ask about your current electric bill? Customer: Its usually around 200 dollars a month. Agent: With a solar system sized for your usage you could reduce that by 60 to 80 percent. Customer: How much does installation cost? Agent: It depends on your roof size and energy needs. We offer free consultations where a technician visits your home. Customer: That sounds reasonable. Agent: Would you like to schedule a consultation? Customer: Yes that would be great. Agent: Perfect. What day works best for you?',
    'Agent: HomeGuard Services how may I help you? Customer: I need to schedule a home inspection. Agent: Certainly. Is this for a new home purchase? Customer: Yes we are closing next month. Agent: Congratulations. We offer comprehensive inspections that cover electrical plumbing HVAC and structural elements. Customer: How long does it take? Agent: Typically 2 to 3 hours depending on the size of the home. Customer: And the cost? Agent: For a standard single family home it is 350 dollars. Customer: That seems fair. Agent: Would you like to book an appointment? Customer: Yes please. Agent: What is the address of the property?',
    'Agent: Thank you for calling. Before we begin I need to inform you this call is being recorded. Is that okay with you? Customer: Yes thats fine. Agent: Great. How can I help you today? Customer: I have questions about my bill. Agent: I would be happy to help. Can I have your account number? Customer: Sure its 98765432. Agent: Thank you. I see your account. What questions do you have? Customer: There is a charge I dont recognize. Agent: Let me look into that. I see a charge from last week. That was for the service call you requested. Customer: Oh right I forgot about that. Agent: No problem. Is there anything else? Customer: No that answers my question. Thank you.'
  ];

  i INTEGER;
  call_date TIMESTAMPTZ;
  call_status TEXT;
  call_revenue NUMERIC;
  call_payout NUMERIC;
  call_duration INTEGER;
  random_val DOUBLE PRECISION;
  publisher_idx INTEGER;
  buyer_idx INTEGER;
  campaign_idx INTEGER;
  state_idx INTEGER;
  transcript TEXT;
  qa_flags_json JSONB;
  call_id UUID;
BEGIN
  -- Delete existing demo calls to ensure clean slate
  DELETE FROM core.calls WHERE org_id = demo_org_id;

  FOR i IN 1..500 LOOP
    -- Random date within last 30 days, weighted toward recent
    random_val := random();
    call_date := NOW() - (power(random_val, 0.7) * INTERVAL '30 days') - (random() * INTERVAL '12 hours');

    -- Determine status with distribution: 10% flagged, 75% safe, 10% pending, 5% failed
    -- Note: Avoiding 'processing' status as it requires storage_path (constraint: valid_processing_state)
    random_val := random();
    IF random_val < 0.10 THEN
      call_status := 'flagged';
    ELSIF random_val < 0.85 THEN
      call_status := 'safe';
    ELSIF random_val < 0.95 THEN
      call_status := 'pending';
    ELSE
      call_status := 'failed';
    END IF;

    -- Random revenue ($0-$150, 20% are zero/non-converted)
    random_val := random();
    IF random_val < 0.20 THEN
      call_revenue := 0;
      call_payout := 0;
    ELSE
      call_revenue := round((random() * 120 + 30)::numeric, 2);
      -- Payout is 30-70% of revenue
      call_payout := round((call_revenue * (0.3 + random() * 0.4))::numeric, 2);
    END IF;

    -- Duration 30 seconds to 15 minutes
    call_duration := 30 + floor(random() * 870)::integer;

    -- Random selections
    publisher_idx := 1 + floor(random() * 8)::integer;
    buyer_idx := 1 + floor(random() * 4)::integer;
    campaign_idx := 1 + floor(random() * 5)::integer;
    state_idx := 1 + floor(random() * 20)::integer;

    -- Generate call ID
    call_id := gen_random_uuid();

    -- Set transcript and QA flags based on status
    IF call_status = 'flagged' THEN
      transcript := flagged_transcripts[1 + floor(random() * 5)::integer];
      qa_flags_json := jsonb_build_object(
        'score', 30 + floor(random() * 40)::integer,
        'summary', 'Potential compliance issues detected in this call.',
        'compliance_issues', jsonb_build_array(
          CASE floor(random() * 5)::integer
            WHEN 0 THEN 'Missing or incomplete disclosure statement'
            WHEN 1 THEN 'Potential misleading claims about savings'
            WHEN 2 THEN 'Aggressive sales tactics detected'
            WHEN 3 THEN 'TCPA consent not properly obtained'
            ELSE 'Caller requested to be removed from list'
          END
        ),
        'customer_sentiment', CASE floor(random() * 3)::integer
          WHEN 0 THEN 'negative'
          WHEN 1 THEN 'frustrated'
          ELSE 'confused'
        END,
        'professionalism_score', 40 + floor(random() * 30)::integer,
        'did_greet', random() > 0.3,
        'did_ask_for_sale', true,
        'analyzed_at', call_date + INTERVAL '5 minutes'
      );
    ELSIF call_status = 'safe' THEN
      transcript := safe_transcripts[1 + floor(random() * 5)::integer];
      qa_flags_json := jsonb_build_object(
        'score', 80 + floor(random() * 20)::integer,
        'summary', 'Call meets compliance standards.',
        'compliance_issues', '[]'::jsonb,
        'customer_sentiment', CASE floor(random() * 3)::integer
          WHEN 0 THEN 'positive'
          WHEN 1 THEN 'neutral'
          ELSE 'satisfied'
        END,
        'professionalism_score', 80 + floor(random() * 20)::integer,
        'did_greet', true,
        'did_ask_for_sale', random() > 0.2,
        'analyzed_at', call_date + INTERVAL '5 minutes'
      );
    ELSE
      transcript := NULL;
      qa_flags_json := NULL;
    END IF;

    -- Insert the call
    INSERT INTO core.calls (
      id,
      org_id,
      ringba_call_id,
      campaign_id,
      start_time_utc,
      updated_at,
      caller_number,
      duration_seconds,
      revenue,
      payout,
      status,
      transcript_text,
      qa_flags,
      qa_version,
      judge_model,
      publisher_id,
      publisher_name,
      buyer_name,
      caller_state,
      caller_city
    ) VALUES (
      call_id,
      demo_org_id,
      'DEMO_' || i || '_' || extract(epoch from call_date)::bigint,
      campaign_ids[campaign_idx],
      call_date,
      call_date + INTERVAL '5 minutes',
      '+1' || (2000000000 + floor(random() * 8000000000)::bigint)::text,
      call_duration,
      call_revenue,
      call_payout,
      call_status,
      transcript,
      qa_flags_json,
      CASE WHEN call_status IN ('flagged', 'safe') THEN 'v2.0' ELSE NULL END,
      CASE WHEN call_status IN ('flagged', 'safe') THEN 'gpt-4o-mini' ELSE NULL END,
      'PUB_' || lpad(publisher_idx::text, 3, '0'),
      publisher_names[publisher_idx],
      buyer_names[buyer_idx],
      states[state_idx],
      CASE states[state_idx]
        WHEN 'FL' THEN (ARRAY['Miami', 'Orlando', 'Tampa', 'Jacksonville'])[1 + floor(random() * 4)::integer]
        WHEN 'CA' THEN (ARRAY['Los Angeles', 'San Diego', 'San Francisco', 'Sacramento'])[1 + floor(random() * 4)::integer]
        WHEN 'TX' THEN (ARRAY['Houston', 'Dallas', 'Austin', 'San Antonio'])[1 + floor(random() * 4)::integer]
        WHEN 'NY' THEN (ARRAY['New York', 'Buffalo', 'Rochester', 'Albany'])[1 + floor(random() * 4)::integer]
        ELSE NULL
      END
    );
  END LOOP;

  RAISE NOTICE 'Created 500 demo calls for org %', demo_org_id;
END $$;

-- 4. Verify the seed data
DO $$
DECLARE
  call_count INTEGER;
  flagged_count INTEGER;
  safe_count INTEGER;
  total_revenue NUMERIC;
BEGIN
  SELECT COUNT(*),
         SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END),
         SUM(CASE WHEN status = 'safe' THEN 1 ELSE 0 END),
         SUM(revenue)
  INTO call_count, flagged_count, safe_count, total_revenue
  FROM core.calls
  WHERE org_id = '00000000-0000-0000-0000-000000000002';

  RAISE NOTICE 'Demo data summary:';
  RAISE NOTICE '  Total calls: %', call_count;
  RAISE NOTICE '  Flagged: %', flagged_count;
  RAISE NOTICE '  Safe: %', safe_count;
  RAISE NOTICE '  Total revenue: $%', total_revenue;
END $$;
