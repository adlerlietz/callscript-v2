-- =============================================================================
-- Migration 51: Area Code to State Lookup for Geo Analytics
-- =============================================================================
-- Problem: Ringba doesn't provide caller state data
-- Solution: Infer state from phone number area code (~95% accurate for landlines)
-- =============================================================================

-- Step 1: Create lookup table
CREATE TABLE IF NOT EXISTS core.area_code_states (
  area_code TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  state_name TEXT NOT NULL
);

-- Step 2: Populate with US area codes (comprehensive list)
INSERT INTO core.area_code_states (area_code, state, state_name) VALUES
-- Alabama
('205', 'AL', 'Alabama'), ('251', 'AL', 'Alabama'), ('256', 'AL', 'Alabama'), ('334', 'AL', 'Alabama'), ('938', 'AL', 'Alabama'),
-- Alaska
('907', 'AK', 'Alaska'),
-- Arizona
('480', 'AZ', 'Arizona'), ('520', 'AZ', 'Arizona'), ('602', 'AZ', 'Arizona'), ('623', 'AZ', 'Arizona'), ('928', 'AZ', 'Arizona'),
-- Arkansas
('479', 'AR', 'Arkansas'), ('501', 'AR', 'Arkansas'), ('870', 'AR', 'Arkansas'),
-- California
('209', 'CA', 'California'), ('213', 'CA', 'California'), ('279', 'CA', 'California'), ('310', 'CA', 'California'), ('323', 'CA', 'California'),
('341', 'CA', 'California'), ('408', 'CA', 'California'), ('415', 'CA', 'California'), ('424', 'CA', 'California'), ('442', 'CA', 'California'),
('510', 'CA', 'California'), ('530', 'CA', 'California'), ('559', 'CA', 'California'), ('562', 'CA', 'California'), ('619', 'CA', 'California'),
('626', 'CA', 'California'), ('628', 'CA', 'California'), ('650', 'CA', 'California'), ('657', 'CA', 'California'), ('661', 'CA', 'California'),
('669', 'CA', 'California'), ('707', 'CA', 'California'), ('714', 'CA', 'California'), ('747', 'CA', 'California'), ('760', 'CA', 'California'),
('805', 'CA', 'California'), ('818', 'CA', 'California'), ('820', 'CA', 'California'), ('831', 'CA', 'California'), ('858', 'CA', 'California'),
('909', 'CA', 'California'), ('916', 'CA', 'California'), ('925', 'CA', 'California'), ('949', 'CA', 'California'), ('951', 'CA', 'California'),
-- Colorado
('303', 'CO', 'Colorado'), ('719', 'CO', 'Colorado'), ('720', 'CO', 'Colorado'), ('970', 'CO', 'Colorado'),
-- Connecticut
('203', 'CT', 'Connecticut'), ('475', 'CT', 'Connecticut'), ('860', 'CT', 'Connecticut'), ('959', 'CT', 'Connecticut'),
-- Delaware
('302', 'DE', 'Delaware'),
-- District of Columbia
('202', 'DC', 'District of Columbia'), ('771', 'DC', 'District of Columbia'),
-- Florida
('239', 'FL', 'Florida'), ('305', 'FL', 'Florida'), ('321', 'FL', 'Florida'), ('352', 'FL', 'Florida'), ('386', 'FL', 'Florida'),
('407', 'FL', 'Florida'), ('561', 'FL', 'Florida'), ('727', 'FL', 'Florida'), ('754', 'FL', 'Florida'), ('772', 'FL', 'Florida'),
('786', 'FL', 'Florida'), ('813', 'FL', 'Florida'), ('850', 'FL', 'Florida'), ('863', 'FL', 'Florida'), ('904', 'FL', 'Florida'),
('941', 'FL', 'Florida'), ('954', 'FL', 'Florida'),
-- Georgia
('229', 'GA', 'Georgia'), ('404', 'GA', 'Georgia'), ('470', 'GA', 'Georgia'), ('478', 'GA', 'Georgia'), ('678', 'GA', 'Georgia'),
('706', 'GA', 'Georgia'), ('762', 'GA', 'Georgia'), ('770', 'GA', 'Georgia'), ('912', 'GA', 'Georgia'), ('943', 'GA', 'Georgia'),
-- Hawaii
('808', 'HI', 'Hawaii'),
-- Idaho
('208', 'ID', 'Idaho'), ('986', 'ID', 'Idaho'),
-- Illinois
('217', 'IL', 'Illinois'), ('224', 'IL', 'Illinois'), ('309', 'IL', 'Illinois'), ('312', 'IL', 'Illinois'), ('331', 'IL', 'Illinois'),
('618', 'IL', 'Illinois'), ('630', 'IL', 'Illinois'), ('708', 'IL', 'Illinois'), ('773', 'IL', 'Illinois'), ('779', 'IL', 'Illinois'),
('815', 'IL', 'Illinois'), ('847', 'IL', 'Illinois'), ('872', 'IL', 'Illinois'),
-- Indiana
('219', 'IN', 'Indiana'), ('260', 'IN', 'Indiana'), ('317', 'IN', 'Indiana'), ('463', 'IN', 'Indiana'), ('574', 'IN', 'Indiana'),
('765', 'IN', 'Indiana'), ('812', 'IN', 'Indiana'), ('930', 'IN', 'Indiana'),
-- Iowa
('319', 'IA', 'Iowa'), ('515', 'IA', 'Iowa'), ('563', 'IA', 'Iowa'), ('641', 'IA', 'Iowa'), ('712', 'IA', 'Iowa'),
-- Kansas
('316', 'KS', 'Kansas'), ('620', 'KS', 'Kansas'), ('785', 'KS', 'Kansas'), ('913', 'KS', 'Kansas'),
-- Kentucky
('270', 'KY', 'Kentucky'), ('364', 'KY', 'Kentucky'), ('502', 'KY', 'Kentucky'), ('606', 'KY', 'Kentucky'), ('859', 'KY', 'Kentucky'),
-- Louisiana
('225', 'LA', 'Louisiana'), ('318', 'LA', 'Louisiana'), ('337', 'LA', 'Louisiana'), ('504', 'LA', 'Louisiana'), ('985', 'LA', 'Louisiana'),
-- Maine
('207', 'ME', 'Maine'),
-- Maryland
('240', 'MD', 'Maryland'), ('301', 'MD', 'Maryland'), ('410', 'MD', 'Maryland'), ('443', 'MD', 'Maryland'), ('667', 'MD', 'Maryland'),
-- Massachusetts
('339', 'MA', 'Massachusetts'), ('351', 'MA', 'Massachusetts'), ('413', 'MA', 'Massachusetts'), ('508', 'MA', 'Massachusetts'),
('617', 'MA', 'Massachusetts'), ('774', 'MA', 'Massachusetts'), ('781', 'MA', 'Massachusetts'), ('857', 'MA', 'Massachusetts'), ('978', 'MA', 'Massachusetts'),
-- Michigan
('231', 'MI', 'Michigan'), ('248', 'MI', 'Michigan'), ('269', 'MI', 'Michigan'), ('313', 'MI', 'Michigan'), ('517', 'MI', 'Michigan'),
('586', 'MI', 'Michigan'), ('616', 'MI', 'Michigan'), ('734', 'MI', 'Michigan'), ('810', 'MI', 'Michigan'), ('906', 'MI', 'Michigan'),
('947', 'MI', 'Michigan'), ('989', 'MI', 'Michigan'),
-- Minnesota
('218', 'MN', 'Minnesota'), ('320', 'MN', 'Minnesota'), ('507', 'MN', 'Minnesota'), ('612', 'MN', 'Minnesota'), ('651', 'MN', 'Minnesota'),
('763', 'MN', 'Minnesota'), ('952', 'MN', 'Minnesota'),
-- Mississippi
('228', 'MS', 'Mississippi'), ('601', 'MS', 'Mississippi'), ('662', 'MS', 'Mississippi'), ('769', 'MS', 'Mississippi'),
-- Missouri
('314', 'MO', 'Missouri'), ('417', 'MO', 'Missouri'), ('573', 'MO', 'Missouri'), ('636', 'MO', 'Missouri'), ('660', 'MO', 'Missouri'),
('816', 'MO', 'Missouri'), ('975', 'MO', 'Missouri'),
-- Montana
('406', 'MT', 'Montana'),
-- Nebraska
('308', 'NE', 'Nebraska'), ('402', 'NE', 'Nebraska'), ('531', 'NE', 'Nebraska'),
-- Nevada
('702', 'NV', 'Nevada'), ('725', 'NV', 'Nevada'), ('775', 'NV', 'Nevada'),
-- New Hampshire
('603', 'NH', 'New Hampshire'),
-- New Jersey
('201', 'NJ', 'New Jersey'), ('551', 'NJ', 'New Jersey'), ('609', 'NJ', 'New Jersey'), ('640', 'NJ', 'New Jersey'), ('732', 'NJ', 'New Jersey'),
('848', 'NJ', 'New Jersey'), ('856', 'NJ', 'New Jersey'), ('862', 'NJ', 'New Jersey'), ('908', 'NJ', 'New Jersey'), ('973', 'NJ', 'New Jersey'),
-- New Mexico
('505', 'NM', 'New Mexico'), ('575', 'NM', 'New Mexico'),
-- New York
('212', 'NY', 'New York'), ('315', 'NY', 'New York'), ('332', 'NY', 'New York'), ('347', 'NY', 'New York'), ('516', 'NY', 'New York'),
('518', 'NY', 'New York'), ('585', 'NY', 'New York'), ('607', 'NY', 'New York'), ('631', 'NY', 'New York'), ('646', 'NY', 'New York'),
('680', 'NY', 'New York'), ('716', 'NY', 'New York'), ('718', 'NY', 'New York'), ('838', 'NY', 'New York'), ('845', 'NY', 'New York'),
('914', 'NY', 'New York'), ('917', 'NY', 'New York'), ('929', 'NY', 'New York'), ('934', 'NY', 'New York'),
-- North Carolina
('252', 'NC', 'North Carolina'), ('336', 'NC', 'North Carolina'), ('704', 'NC', 'North Carolina'), ('743', 'NC', 'North Carolina'),
('828', 'NC', 'North Carolina'), ('910', 'NC', 'North Carolina'), ('919', 'NC', 'North Carolina'), ('980', 'NC', 'North Carolina'), ('984', 'NC', 'North Carolina'),
-- North Dakota
('701', 'ND', 'North Dakota'),
-- Ohio
('216', 'OH', 'Ohio'), ('220', 'OH', 'Ohio'), ('234', 'OH', 'Ohio'), ('283', 'OH', 'Ohio'), ('326', 'OH', 'Ohio'),
('330', 'OH', 'Ohio'), ('380', 'OH', 'Ohio'), ('419', 'OH', 'Ohio'), ('440', 'OH', 'Ohio'), ('513', 'OH', 'Ohio'),
('567', 'OH', 'Ohio'), ('614', 'OH', 'Ohio'), ('740', 'OH', 'Ohio'), ('937', 'OH', 'Ohio'),
-- Oklahoma
('405', 'OK', 'Oklahoma'), ('539', 'OK', 'Oklahoma'), ('580', 'OK', 'Oklahoma'), ('918', 'OK', 'Oklahoma'),
-- Oregon
('458', 'OR', 'Oregon'), ('503', 'OR', 'Oregon'), ('541', 'OR', 'Oregon'), ('971', 'OR', 'Oregon'),
-- Pennsylvania
('215', 'PA', 'Pennsylvania'), ('223', 'PA', 'Pennsylvania'), ('267', 'PA', 'Pennsylvania'), ('272', 'PA', 'Pennsylvania'),
('412', 'PA', 'Pennsylvania'), ('445', 'PA', 'Pennsylvania'), ('484', 'PA', 'Pennsylvania'), ('570', 'PA', 'Pennsylvania'),
('610', 'PA', 'Pennsylvania'), ('717', 'PA', 'Pennsylvania'), ('724', 'PA', 'Pennsylvania'), ('814', 'PA', 'Pennsylvania'), ('878', 'PA', 'Pennsylvania'),
-- Rhode Island
('401', 'RI', 'Rhode Island'),
-- South Carolina
('803', 'SC', 'South Carolina'), ('839', 'SC', 'South Carolina'), ('843', 'SC', 'South Carolina'), ('854', 'SC', 'South Carolina'), ('864', 'SC', 'South Carolina'),
-- South Dakota
('605', 'SD', 'South Dakota'),
-- Tennessee
('423', 'TN', 'Tennessee'), ('615', 'TN', 'Tennessee'), ('629', 'TN', 'Tennessee'), ('731', 'TN', 'Tennessee'), ('865', 'TN', 'Tennessee'), ('901', 'TN', 'Tennessee'), ('931', 'TN', 'Tennessee'),
-- Texas
('210', 'TX', 'Texas'), ('214', 'TX', 'Texas'), ('254', 'TX', 'Texas'), ('281', 'TX', 'Texas'), ('325', 'TX', 'Texas'),
('346', 'TX', 'Texas'), ('361', 'TX', 'Texas'), ('409', 'TX', 'Texas'), ('430', 'TX', 'Texas'), ('432', 'TX', 'Texas'),
('469', 'TX', 'Texas'), ('512', 'TX', 'Texas'), ('682', 'TX', 'Texas'), ('713', 'TX', 'Texas'), ('726', 'TX', 'Texas'),
('737', 'TX', 'Texas'), ('806', 'TX', 'Texas'), ('817', 'TX', 'Texas'), ('830', 'TX', 'Texas'), ('832', 'TX', 'Texas'),
('903', 'TX', 'Texas'), ('915', 'TX', 'Texas'), ('936', 'TX', 'Texas'), ('940', 'TX', 'Texas'), ('956', 'TX', 'Texas'),
('972', 'TX', 'Texas'), ('979', 'TX', 'Texas'),
-- Utah
('385', 'UT', 'Utah'), ('435', 'UT', 'Utah'), ('801', 'UT', 'Utah'),
-- Vermont
('802', 'VT', 'Vermont'),
-- Virginia
('276', 'VA', 'Virginia'), ('434', 'VA', 'Virginia'), ('540', 'VA', 'Virginia'), ('571', 'VA', 'Virginia'), ('703', 'VA', 'Virginia'), ('757', 'VA', 'Virginia'), ('804', 'VA', 'Virginia'), ('826', 'VA', 'Virginia'), ('948', 'VA', 'Virginia'),
-- Washington
('206', 'WA', 'Washington'), ('253', 'WA', 'Washington'), ('360', 'WA', 'Washington'), ('425', 'WA', 'Washington'), ('509', 'WA', 'Washington'), ('564', 'WA', 'Washington'),
-- West Virginia
('304', 'WV', 'West Virginia'), ('681', 'WV', 'West Virginia'),
-- Wisconsin
('262', 'WI', 'Wisconsin'), ('414', 'WI', 'Wisconsin'), ('534', 'WI', 'Wisconsin'), ('608', 'WI', 'Wisconsin'), ('715', 'WI', 'Wisconsin'), ('920', 'WI', 'Wisconsin'),
-- Wyoming
('307', 'WY', 'Wyoming'),
-- US Territories
('340', 'VI', 'US Virgin Islands'),
('671', 'GU', 'Guam'),
('787', 'PR', 'Puerto Rico'), ('939', 'PR', 'Puerto Rico'),
('684', 'AS', 'American Samoa'),
('670', 'MP', 'Northern Mariana Islands')
ON CONFLICT (area_code) DO NOTHING;

-- Step 3: Create helper function for extracting area code
CREATE OR REPLACE FUNCTION core.extract_area_code(phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits TEXT;
BEGIN
  IF phone IS NULL THEN
    RETURN NULL;
  END IF;

  -- Remove all non-digits
  digits := REGEXP_REPLACE(phone, '[^0-9]', '', 'g');

  -- Handle different formats
  IF LENGTH(digits) = 11 AND digits LIKE '1%' THEN
    -- +1XXXXXXXXXX or 1XXXXXXXXXX
    RETURN SUBSTRING(digits FROM 2 FOR 3);
  ELSIF LENGTH(digits) = 10 THEN
    -- XXXXXXXXXX
    RETURN SUBSTRING(digits FROM 1 FOR 3);
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

-- Step 4: Backfill existing calls
UPDATE core.calls c
SET caller_state = acs.state
FROM core.area_code_states acs
WHERE c.caller_state IS NULL
  AND c.caller_number IS NOT NULL
  AND core.extract_area_code(c.caller_number) = acs.area_code;

-- Step 5: Create index for area code lookups
CREATE INDEX IF NOT EXISTS idx_area_code_states_state
ON core.area_code_states(state);

-- Log results
DO $$
DECLARE
  backfilled_count INTEGER;
  total_area_codes INTEGER;
BEGIN
  SELECT COUNT(*) INTO backfilled_count FROM core.calls WHERE caller_state IS NOT NULL;
  SELECT COUNT(*) INTO total_area_codes FROM core.area_code_states;
  RAISE NOTICE 'Migration complete: % area codes loaded, % calls have caller_state', total_area_codes, backfilled_count;
END $$;
