-- 0063_excel_corpus_alignment.sql
-- T-105 / MIG-TOKENS — align the live financial corpus to the SOURCE WORKBOOK
-- (Suivis clients  2026_2027.xlsx, sheet ETAT 20262027, rows 2-391).
--
-- DISCOVERY (2026-09-01, T-105 Excel-corpus equivalence run): the workbook is
-- internally consistent (P = R+S+T+U+W+X+Y for 390/390 rows; Q = L - P for
-- 390/390 rows; L's own formula already subtracts the REMISE, e.g. row 2:
-- '=25000+205000+35000-J2'). The live corpus diverges from it in three ways:
--
--   DATA-010 — DOUBLE-REMISE (223 parents, Σ -9,709,700 DZD): the import wrote
--     the DEVIS charge from column L (ALREADY net of remise) and THEN a
--     separate "Remise sur devis" adjustment of -J — discounting twice. The
--     parents' net obligation is understated by their remise; parents who paid
--     their exact devis show a fake "credit" (e.g. ZIREG LEA: devis 239,500
--     paid 239,500, Excel créance 0 — corpus balance -25,500).
--     Root cause: repository-adapter.ts buildFinancialEntries REMISE block.
--     FIX: compensating +|amount| adjustments (append-only, forensics kept).
--
--   DATA-011 — ROW 242 NEVER IMPORTED (SIDI MAMER SAMYI, phone 0554288142,
--     devis 255,000, versements 255,000, créance 0): the 2026-08-11 bulk
--     import dropped the row entirely (same-name collision with row 235's
--     student under parent 0550067500 — the DB has only 2 of the 3 students).
--     FIX: create the parent + student + tranches + charge + payments exactly
--     per the workbook row.
--
--   DATA-003 (extension) — SCHEDULE-VS-DEVIS residuals (~35 parents, Σ ≈
--     +1.85M DZD after the remise cancel): tranches/charges generated from the
--     Prices.md grids exceed the negotiated Excel devis. 0062 corrected one
--     student (SIDI MAMER row 235); the rest were never aligned.
--     FIX: per-student alignment adjustment + tranche absorption (last-tranche
--     rule, same as 0062's deterministic precedent).
--
-- After STEP 1-3 the corpus satisfies, for EVERY student of the workbook:
--   netdue (charges + adjustments) == DEVIS + DETTES
--   Σ installments amount_due     == DEVIS + DETTES   (C3 preserved)
-- and for every parent:
--   paid == TOTAL VERSEMENTS (already true, except row 242's missing 255,000)
--   balance == DEVIS + DETTES − VERSEMENTS == Excel TOTAL*CREANCE (+dettes)
--
-- STEP 4 replays ALL payments through the canonical waterfall (0062 STEP 5
-- pattern + an explicit payment_allocations DELETE) so payment_allocations,
-- expected/excess and installment links match the new totals.
--
-- Idempotency: guarded by the audit marker 'financial.reconcile_0063' and
-- per-step NOT EXISTS / unique-source_id guards. On a FRESH deployment
-- (empty tables) every step targets zero rows.
--
-- MIG-TOKENS: this file + its schema_migrations registration are applied in
-- ONE atomic transaction by scripts/apply_0063_live.sh.

DO $$
DECLARE
  v_tenant uuid;
  v_comp_rows int := 0;
  v_created_parent int := 0;
  v_created_student int := 0;
  v_created_tranches int := 0;
  v_created_payments int := 0;
  v_align_rows int := 0;
  v_absorb_rows int := 0;
  v_alloc_rows int := 0;
  v_pay_rows int := 0;
  v_reset_rows int := 0;
  v_new_parent uuid;
  v_new_student uuid;
  v_pay_code text;
  v_target numeric;
  v_delta numeric;
  v_ins_sum numeric;
  v_ins_delta numeric;
  v_absorb_left numeric;
  v_take numeric;
  v_parent record;
  v_cat text;
  v_pay record;
  v_ins record;
  v_remaining numeric;
  v_allocate numeric;
  v_ins_remaining numeric;
  v_alloc_count int;
  v_single_target uuid;
  v_new_paid numeric;
  v_new_status text;
  v_stu record;
BEGIN
  SELECT id INTO v_tenant FROM tenants ORDER BY created_at LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE NOTICE '0063: no tenant rows — fresh deployment, nothing to align';
    RETURN;
  END IF;

  -- GUARD: already applied?
  IF EXISTS (SELECT 1 FROM audit_logs WHERE tenant_id = v_tenant
             AND action = 'financial.reconcile_0063' LIMIT 1) THEN
    RAISE NOTICE '0063: reconciliation marker present — skipped';
    RETURN;
  END IF;

  -- The workbook corpus (per student row of ETAT 20262027, rows 2-391).
  -- xl_phone: first NEM segment, digits, leading zeros stripped ('' when
  -- unusable). xl_unique: the student name appears exactly once in the
  -- workbook (tier-2 name-only matching is only safe for unique names).
  CREATE TEMP TABLE _t105_corpus(
    xl_row int, xl_name text, xl_phone text, xl_unique boolean,
    xl_devis numeric, xl_dettes numeric);
  INSERT INTO _t105_corpus VALUES
(2, 'ZIREG LEA', '663701834', 'true', 239500, 0),
(3, 'MERABTI RIHAM', '799534750', 'true', 294500, 0),
(4, 'BOUAICHA ACIL', '770264718', 'true', 260000, 0),
(5, 'SEDIKI ISHAK', '795144767', 'true', 382000, 0),
(6, 'SEDIKI YAKOUB', '795144767', 'true', 317000, 0),
(7, 'ZERGANI MAHDI', '794811578', 'true', 308000, 0),
(8, 'ZERGANI CHOAIB', '794811578', 'true', 356000, 0),
(9, 'ZERGANI YAHIA', '794811578', 'true', 356000, 0),
(10, 'YOUCEFI NAZIM', '660811501', 'true', 292500, 0),
(11, 'KHALDOUN HACENE', '796945858', 'true', 240000, 0),
(12, 'KHALDOUNE NOUR', '796945858', 'true', 209000, 0),
(13, 'SEDIKI NASSIM', '661308311', 'true', 267000, 0),
(14, 'SEDIKI YACINE', '661308311', 'true', 340000, 0),
(15, 'HAMADACHE AHMED', '561343761', 'true', 303000, 0),
(16, 'ALLOUCHE CHAIMA', '661652830', 'true', 396000, 0),
(17, 'GASSMI YOUNES', '796519468', 'true', 320500, 0),
(18, 'GASSMI YASSINE', '796519468', 'true', 328000, 0),
(19, 'ABDENOUS ABDERHMAN', '792775082', 'true', 371000, 0),
(20, 'ABDENOUS ACIL', '792775082', 'true', 280000, 0),
(21, 'SITOUAH ALAAEDINE YOUCEF', '672208803', 'true', 245000, 0),
(22, 'BENYOUCEF ANAIS', '776590820', 'true', 260000, 0),
(23, 'LAMARA MED SARA', '556517114', 'true', 350000, 0),
(24, 'RABIA HACEN', '698868963', 'true', 309000, 0),
(25, 'MENSOUR DOUHA', '560245811', 'true', 355000, 0),
(26, 'HAMIDOUCH YANIS', '791948957', 'true', 367000, 0),
(27, 'TAKOUCHET ROUAIA', '550265831', 'true', 371000, 0),
(28, 'BERAHIMI RACIM', '699718098', 'true', 260000, 0),
(29, 'BERAHIMI RIMES', '699718098', 'true', 306000, 0),
(30, 'REZIG WALID', '562873864', 'true', 275000, 0),
(31, 'TAMERYOULT MALAK', '661742904', 'true', 367000, 0),
(32, 'KESASI ELYAS', '', 'true', 304000, 0),
(33, 'ATTOUCHE MASSIL', '561678897', 'true', 283000, 0),
(34, 'ABDI DANIA', '559744831', 'true', 148000, 0),
(35, 'LOUANCHI RITADJE', '555647502', 'true', 280000, 0),
(36, 'LOUANCHI MERIEME', '555647502', 'true', 305000, 0),
(37, 'BENZAOUI KHADIJA', '699015001', 'true', 310500, 0),
(38, 'BENZAOUIMED TAHA', '699015001', 'true', 320000, 0),
(39, 'BENZAOUI FATIMA', '699015001', 'true', 280000, 0),
(40, 'BENZAOUI AHMED YACINE', '699015001', 'true', 133000, 0),
(41, 'MOUAS LINA', '557672219', 'true', 260000, 0),
(42, 'MOUAS YOUNES', '557672219', 'true', 178000, 0),
(43, 'MOKADEM CIDRA', '771062618', 'true', 222000, 0),
(44, 'MOKADEM RIMA', '771062618', 'true', 380000, 0),
(45, 'MOKADEM OMAR', '771062618', 'true', 345000, 0),
(46, 'HAMOUDI ANIAS', '667315937', 'true', 290000, 0),
(47, 'HAMOUDI DJAOUAD', '667315937', 'true', 255500, 0),
(48, 'BICHA MED', '', 'true', 212000, 0),
(49, 'BIDA TASSNIM', '674675003', 'true', 205000, 0),
(50, 'BIDA MED', '674675003', 'true', 205000, 0),
(51, 'BENABDELKRIM MED', '799549249', 'true', 227000, 0),
(52, 'KHELOUI INES', '671418214', 'true', 262000, 0),
(53, 'KHELOUI HADJER', '671418214', 'true', 305000, 0),
(54, 'LAOUFI CHAHIN', '551058054', 'true', 267000, 0),
(55, 'ABADA YAHIA', '696471214', 'true', 285000, 0),
(56, 'AZIBI MAISSA', '553936243', 'true', 247500, 0),
(57, 'AZIBI AMIR', '553936243', 'true', 320500, 0),
(58, 'REDOUAN RACIM', '558507959', 'true', 264500, 0),
(59, 'REMDAN MANAR', '552707748', 'true', 348500, 0),
(60, 'LAGHRIBI MED ABDELMALEK', '557381050', 'true', 348500, 0),
(61, 'HEMMANI MILINA', '783094441', 'true', 285000, 0),
(62, 'MEFTAH INES', '559444354', 'true', 280000, 0),
(63, 'MEFTAH MEREME', '559444354', 'true', 330000, 0),
(64, 'CHIRIFI ACIF', '772172088', 'true', 282000, 0),
(65, 'BOUCHLAGHEM NELIA', '540686162', 'true', 238500, 0),
(66, 'BOUCHLAGHEM JUBA', '540686162', 'true', 213000, 0),
(67, 'BOUCHLAGHEM ANIA', '540686162', 'true', 294000, 0),
(68, 'ABID SIRINE', '551005941', 'true', 285000, 0),
(69, 'FROUKHI MEREIM', '555159369', 'true', 309000, 0),
(70, 'TABET MED REDA', '793371271', 'true', 245000, 0),
(71, 'MAHMEL RABAH', '774560459', 'true', 299000, 0),
(72, 'BELAGHA MANIL', '665650997', 'true', 355000, 0),
(73, 'HALIMI SIRINE', '', 'true', 262000, 0),
(74, 'HALIMI HADJER', '', 'true', 290000, 0),
(75, 'HALIMI MAHDI', '', 'true', 362000, 0),
(76, 'ALLOUNE AMINA', '561442100', 'true', 292000, 0),
(77, 'ALLOUNE ANES', '561442100', 'true', 312000, 0),
(78, 'ALLOUNE ABDERHIM', '561442100', 'true', 392000, 0),
(79, 'GETAF ANIS', '669507327', 'true', 417000, 0),
(80, 'GETAF NASSIM', '669507327', 'true', 392000, 0),
(81, 'AZZEDINE AOUSE', '550650675', 'true', 300000, 0),
(82, 'TOUBAL YOUNES', '553141966', 'true', 350000, 0),
(83, 'TOUBAL ADEL', '553141966', 'true', 290000, 0),
(84, 'HEMDOUNE WASSIM', '560066919', 'true', 320000, 0),
(85, 'MEZIAN ILYES', '673127513', 'true', 245000, 0),
(86, 'HAMIDI ILYANE', '773324163', 'true', 199000, 0),
(87, 'HAMADACHE IMANE', '775170718', 'true', 309000, 0),
(88, 'BEDJIL IYAD', '774909791', 'true', 250000, 0),
(89, 'BEDJIL WAKIL', '774909791', 'true', 275000, 0),
(90, 'RACHDI CHAZIA', '557977768', 'true', 279500, 0),
(91, 'GAHAM LAYAN AROUA', '669840195', 'true', 239500, 0),
(92, 'HAOUCHE WASSIM', '549478724', 'true', 290000, 0),
(93, 'DRIF LINA', '553044356', 'true', 262000, 0),
(94, 'DERIF ADEM', '553044356', 'true', 268000, 0),
(95, 'DERIF ANIA', '553044356', 'true', 320500, 0),
(96, 'HEMLAOUISOFIA', '771316986', 'true', 310000, 0),
(97, 'BOUDERBALA NESRINE', '698053535', 'true', 280000, 0),
(98, 'BOUDERBALA ILYES', '698053535', 'true', 267000, 0),
(99, 'BOUDERBALA YACINE', '698053535', 'true', 178000, 0),
(100, 'ROUIBET CHAKIB', '558487705', 'true', 340000, 0),
(101, 'ACHOUR NIHAL', '550667501', 'true', 230000, 0),
(102, 'ACHOUR ILYES', '550667501', 'true', 275000, 0),
(103, 'BINAKLI ANEL', '770645083', 'true', 242000, 0),
(104, 'BINAKLI GHILES', '770645083', 'true', 235000, 0),
(105, 'TOUILEB ABDERAOUF', '550937900', 'true', 398000, 0),
(106, 'AFRA ZINEDINE', '663165036', 'true', 343000, 0),
(107, 'BENGHAZI RISEN', '550143425', 'true', 227000, 0),
(108, 'ELOUTAR MERIEM', '671532014', 'true', 260000, 0),
(109, 'AITTAHER FLOURA', '661788697', 'true', 234500, 0),
(110, 'BENHASSEL LINA', '560988717', 'true', 610000, 0),
(111, 'NEKACHE MASSYL', '560191680', 'true', 303000, 0),
(112, 'BENMILOUD YOUNES', '553461562', 'true', 255000, 0),
(113, 'BOUDOUR MARAM', '559816870', 'true', 281500, 0),
(114, 'ZIANI ILINE', '556489591', 'true', 267000, 0),
(115, 'ZIANI IDRIS', '556489591', 'true', 345000, 0),
(116, 'HAMIDI HACEN', '6603690796', 'true', 433000, 0),
(117, 'HAMIDI HADJIBRAHIM', '6603690796', 'true', 370000, 0),
(118, 'HAMIDI YOUCEF', '6603690796', 'true', 318000, 0),
(119, 'HAMIDI YACINE', '6603690796', 'true', 293000, 0),
(120, 'HAMIDI HOUCINE', '6603690796', 'true', 221000, 0),
(121, 'ABED ANES', '556220809', 'true', 323000, 0),
(122, 'TARZALT NELIA', '552297448', 'true', 245000, 0),
(123, 'BENLAMARA MED MEZIAN', '666915449', 'true', 371000, 0),
(124, 'ZEMMOURI ACIL', '560202288', 'true', 280000, 0),
(125, 'ZEMMOURI MEREIME', '560202288', 'true', 280000, 0),
(126, 'ZEMMOURI TASSNIM', '560202288', 'true', 179000, 0),
(127, 'BOUDALIA NIHAL', '697940776', 'true', 295000, 0),
(128, 'BOUDOULIA NESRINE', '697940776', 'true', 300000, 0),
(129, 'METAH NADA', '770755658', 'true', 234500, 7000),
(130, 'METAH YAHIA', '770755658', 'true', 244000, 0),
(131, 'YAHYAOUI TASSNIM', '550649850', 'true', 224000, 0),
(132, 'YAHYAOUI LOUAI', '550649850', 'true', 148000, 0),
(133, 'CHALABI WISSAL', '676904242', 'true', 351000, 0),
(134, 'CHALABI ADEM', '676904242', 'true', 284000, 0),
(135, 'SADOUNI ALINA', '770444768', 'true', 245000, 0),
(136, 'REZAG NAILA', '541076579', 'true', 240000, 0),
(137, 'REZAG YOUNES', '541076579', 'true', 304000, 0),
(138, 'REZAG LINA', '541076579', 'true', 310000, 0),
(139, 'HALYI AICHA', '554089107', 'true', 350000, 0),
(140, 'HALYI TASSNIM', '554089107', 'true', 395000, 0),
(141, 'BOUCIF RYM', '540371546', 'true', 178000, 0),
(142, 'BOUTELDJI ALICIA', '799713434', 'true', 227000, 0),
(143, 'HEBROUCH MARIA', '771235264', 'true', 299000, 0),
(144, 'BOUFAGHES AYOUB', '670106740', 'true', 280000, 0),
(145, 'REZAL ADEM', '542181649', 'true', 280000, 0),
(146, 'HADHOUM ADEM', '552990331', 'true', 345000, 0),
(147, 'BERIKI MAROUA', '778442394', 'true', 332000, 0),
(148, 'HADJESABRI ANES', '674593137', 'true', 260000, 0),
(149, 'RAHMOUN SOHAIB', '555616851', 'true', 283000, 0),
(150, 'ZIYAD ADEM', '', 'true', 260000, 0),
(151, 'BENBOURAHLA SOFIA', '556070642', 'true', 327500, 0),
(152, 'BENBOURAHLA CHIRIN', '556070642', 'true', 320500, 0),
(153, 'BENBOURAHLA DANIA', '556070642', 'true', 320500, 0),
(154, 'ISSAADI IYAS', '797451905', 'true', 235000, 0),
(155, 'SOUMER CHAKIB', '', 'true', 280000, 0),
(156, 'BELLAL DOUAA', '779933786', 'true', 362000, 0),
(157, 'ALIOUAT LINDA', '783075120', 'true', 350000, 0),
(158, 'BENDIFLLAH AMIR', '670214335', 'true', 385000, 0),
(159, 'BECHAN IYAD', '664783334', 'true', 187000, 0),
(160, 'BECHAN MARAM', '664783334', 'true', 232000, 0),
(161, 'LAOUIDI LINA', '661163134', 'true', 303000, 0),
(162, 'BOUCHLALAA IKRAM', '550863409', 'true', 397000, 0),
(163, 'BOUADOU AZAD', '552976923', 'true', 249000, 0),
(164, 'BECHICHI IYAD', '665456508', 'true', 226500, 0),
(165, 'ATTOUCH MARAM', '561922991', 'true', 227000, 0),
(166, 'ZEMMOUR AMEL', '799486046', 'true', 260000, 0),
(167, 'MEGDOUD DJAD', '559186412', 'true', 260000, 0),
(168, 'TELAILIA SALAHEDIN', '657115721', 'true', 262000, 0),
(169, 'ZAD WASSIM', '558725701', 'true', 320000, 0),
(170, 'FOUIDI MAISSA', '661351504', 'true', 304000, 0),
(171, 'FOUIDI INES', '661351504', 'true', 244000, 0),
(172, 'KHIREDINE ILINE', '777471923', 'true', 240000, 0),
(173, 'BENZAOUI DJOUAD', '667682064', 'true', 310000, 0),
(174, 'BENZAOUI SAID', '667682064', 'true', 323000, 0),
(175, 'SOUAG RIHAM', '771603158', 'true', 309000, 0),
(176, 'TOURKI YOUCEF', '5501847654', 'true', 278000, 0),
(177, 'HADOUCHD DANI', '540592933', 'true', 254000, 0),
(178, 'TAHIR AHMED GHAIT', '771762903', 'true', 227000, 0),
(179, 'DJAFER MILISSA', '792970235', 'true', 208000, 0),
(180, 'ZEROUK FATIMA', '697878246', 'true', 305000, 0),
(181, 'ZEROUK AHMED YACINE', '697878246', 'true', 260000, 0),
(182, 'ZEROUK MED ABDELMOUMEN', '697878246', 'true', 222000, 0),
(183, 'HOUASEN MED WALID', '673247969', 'true', 245000, 0),
(184, 'REZAOUI ILYAN', '770759451', 'true', 279000, 0),
(185, 'SELLAM CHAIMA', '782904949', 'true', 288000, 0),
(186, 'DJAIZ ZAYN', '541921109', 'true', 227000, 0),
(187, 'BENDIFLLAH SAMYI', '561836201', 'true', 450000, 0),
(188, 'BENSAED MED DJAZIL', '562062854', 'true', 395000, 0),
(189, 'DJOUAHRA KHALIL', '540446159', 'true', 385000, 0),
(190, 'DJOUAHRA LILIA', '540446159', 'true', 417000, 0),
(191, 'BAKHLAL IBTISSEM', '770315116', 'true', 357200, 0),
(192, 'BAKHLAL SABRIMA', '770315116', 'true', 337200, 0),
(193, 'BAKHLAL WISSEM', '770315116', 'true', 272200, 0),
(194, 'BAKHLAL KARIM', '770315116', 'true', 247200, 0),
(195, 'ELKRIA ANIA', '550403653', 'true', 315000, 0),
(196, 'ELKRIA INES', '550403653', 'true', 290000, 0),
(197, 'ELKRIA TALIN', '550403653', 'true', 230000, 0),
(198, 'LOUNACI AGHILES', '560971846', 'true', 234500, 0),
(199, 'LOUNACI YOUNES', '560971846', 'true', 298000, 0),
(200, 'BOUSLAH MARIA', '541053256', 'true', 335000, 0),
(201, 'NACEF LIDIA', '667772179', 'true', 245000, 0),
(202, 'BOUROUBAA MED ANES', '556241098', 'true', 245000, 0),
(203, 'TABOUCHENT GHOFRAN', '542293583', 'true', 282000, 0),
(204, 'MAHMOUDI SARA', '662103351', 'true', 320000, 0),
(205, 'TOUATI ABDERHMAN', '661128618', 'true', 272000, 0),
(206, 'ABDELLAOUI MED', '770262354', 'true', 223000, 0),
(207, 'ABDELLAOUI MED RACIM', '770262354', 'true', 327700, 0),
(208, 'ABDELLAOUI RIHAN', '770262354', 'true', 302500, 0),
(209, 'ALLOU ABDERHIM', '770359659', 'true', 202500, 0),
(210, 'REBAHI ILYES', '553010598', 'true', 239500, 0),
(211, 'HEBIB ANAIS', '661763748', 'true', 274500, 0),
(212, 'HEBIB AMANI', '661763748', 'true', 203500, 0),
(213, 'REZAK RAYAN', '', 'true', 269300, 0),
(214, 'REZAK ADEM', '', 'true', 201200, 0),
(215, 'REZAK AYLA', '', 'true', 229500, 0),
(216, 'BEKKOUCH MERIEM', '697350066', 'true', 285000, 0),
(217, 'BEKKOUCH LINA', '697350066', 'true', 260000, 0),
(218, 'BEKKOUCH NESRINE', '697350066', 'true', 358000, 0),
(219, 'AMARA SAID RAYAN', '658702416', 'true', 355000, 0),
(220, 'IHEDADEN YACINE', '556525074', 'true', 300000, 0),
(221, 'IFTAN MASSIL', '553551962', 'true', 267000, 0),
(222, 'YAYCI AKCIL', '668517169', 'true', 240000, 0),
(223, 'YAYCI MASSYLE', '668517169', 'true', 240000, 0),
(224, 'YAYCI SYRIA', '668517169', 'true', 240000, 0),
(225, 'HEMLAOUI ISSLEM', '549638195', 'true', 380000, 0),
(226, 'AMBER IBRAHIM', '', 'true', 317000, 0),
(227, 'ZEMMOURI SAED', '5553180504', 'true', 329500, 0),
(228, 'ZEMMOURI MEREIEM', '5553180504', 'true', 353000, 0),
(229, 'BELGRIMAT LINA', '661607648', 'true', 295000, 0),
(230, 'BELGRIMAT MILINA', '661607648', 'true', 279500, 0),
(231, 'ATTAB YANI', '541324865', 'true', 295000, 0),
(232, 'ATTAB DANIA', '541324865', 'true', 340000, 0),
(233, 'ELMAHDAOUI WASSIM', '559436333', 'true', 355000, 0),
(234, 'REBAHI ELYES', '773021710', 'true', 304000, 0),
(235, 'SIDI MAMER SAMYI', '550067500', 'false', 236750, 0),
(236, 'NAGHMOUCH YANIS MED', '550067500', 'true', 226750, 0),
(237, 'DJEMAA WASSIM', '676670289', 'true', 243000, 0),
(238, 'OUAZAR SARA', '558274831', 'true', 240000, 0),
(239, 'OUAZAR SAMYI', '558274831', 'true', 311000, 0),
(240, 'BENHAMED MILINA', '554733582', 'true', 395000, 0),
(241, 'BENHAMED NELIA', '554733582', 'true', 355000, 0),
(242, 'SIDI MAMER SAMYI', '554288142', 'false', 255000, 0),
(243, 'GHENAI SOFIA', '661923775', 'true', 267000, 0),
(244, 'ALLOUDA ZAKRIA', '550902630', 'true', 365000, 0),
(245, 'OUALI ILINE', '', 'true', 239500, 0),
(246, 'TERTAK MASSIL', '540875675', 'true', 227000, 0),
(247, 'GHAZIBAOUN MED', '771582540', 'true', 245000, 0),
(248, 'KOUBAA CHOUROK', '661653282', 'true', 385000, 0),
(249, 'KOUBAA HALA', '661653282', 'true', 345000, 0),
(250, 'KOUBAA AHLAM', '661653282', 'true', 286000, 0),
(251, 'KOUBAA DJANA', '661653282', 'true', 144000, 0),
(252, 'KHIREDINE IYAD', '560521704', 'true', 180000, 0),
(253, 'ALLOU MED AMIR', '770359659', 'true', 112000, 0),
(254, 'SALHI NOURHAN', '556128693', 'true', 295000, 0),
(255, 'SALHI MARAM', '556128693', 'true', 230000, 0),
(256, 'DJAOUD YASSMIN', '661674519', 'true', 295000, 0),
(257, 'DJAOUD SARA', '661674519', 'true', 317800, 0),
(258, 'AZIZI MED', '771051387', 'true', 342000, 0),
(259, 'AZIZI MOUSAB', '771051387', 'true', 280000, 0),
(260, 'AZIZI HAITHEM', '771051387', 'true', 320000, 0),
(261, 'BOUMCHOUAN LINA', '664120160', 'true', 267000, 0),
(262, 'DIHIIMI HAITHEM', '791491620', 'true', 309000, 0),
(263, 'RIAL AMIRA', '559338574', 'true', 375000, 0),
(264, 'BERA ADEM', '661519304', 'true', 228500, 0),
(265, 'BERA AYA', '661519304', 'true', 233500, 0),
(266, 'KHEMISI MILINA', '559792068', 'true', 275000, 0),
(267, 'MEDJIDEL MANEL', '553155729', 'true', 355000, 0),
(268, 'FERDIA BARAA', '664004278', 'true', 247000, 0),
(269, 'ABDELAOUI SAMYI', '699930480', 'true', 305000, 0),
(270, 'ABDELAOUI INES', '699930480', 'true', 330000, 0),
(271, 'ABDELAOUI RAZAN', '699930480', 'true', 262000, 0),
(272, 'HAIL IMANE', '556331320', 'true', 330000, 0),
(273, 'DJEDID INES', '661114117', 'true', 280000, 0),
(274, 'MEDJEDEL MED AYMEN', '555804059', 'true', 283000, 0),
(275, 'MEDJEDEL ANES', '799198494', 'true', 218000, 0),
(276, 'YAMMI INES', '796782985', 'true', 255000, 0),
(277, 'YAMMI MED AMEZIANE', '796782985', 'true', 175000, 0),
(278, 'GHERBI WASSIM', '553444260', 'true', 435000, 0),
(279, 'KESASI LILIA', '', 'true', 227500, 0),
(280, 'BOUROUROU MED HIATHEM', '671786386', 'true', 329000, 0),
(281, 'AZAZNA HOUCEM', '555401000', 'true', 230000, 0),
(282, 'AZAZNA ILINE', '555401000', 'true', 190000, 0),
(283, 'LOUNA ASSMA', '662508266', 'true', 345000, 0),
(284, 'LOUNA ZAKRIA', '662508266', 'true', 275000, 0),
(285, 'LOUNA MED AMINE', '662508266', 'true', 120000, 0),
(286, 'LOUNA AYOUB', '662508266', 'true', 278500, 0),
(287, 'GHISSI MAYA MALAK', '559585411', 'true', 342000, 0),
(288, 'BOUISSRI NASSIM', '556908672', 'true', 288000, 0),
(289, 'DJEMAA ZINEB', '560883040', 'true', 308000, 0),
(290, 'SEMMAR MEREIM', '664776136', 'true', 268000, 0),
(291, 'DOUKHALI KHALIL', '5563246380540181197', 'true', 400000, 0),
(292, 'TOUIDJINE LOUAI', '661122823', 'true', 315000, 0),
(293, 'TOUIDJIN LOKMAN', '661122823', 'true', 215000, 0),
(294, 'BOULKROUN RAHIL', '661652502', 'true', 204000, 0),
(295, 'BOULKROUN MEREIME', '661652502', 'true', 158500, 0),
(296, 'OUAGNOUNI NIHAL', '661652502', 'true', 326500, 0),
(297, 'SAHRAOUI AMIR', '540450066', 'true', 267000, 0),
(298, 'SAHRAOUI WIDAD', '540450066', 'true', 291000, 0),
(299, 'SAHRAOUI DJASER', '540450066', 'true', 154000, 0),
(300, 'SAHRAOUI SALAM DAKER', '540450066', 'true', 197500, 0),
(301, 'SEMAAN ZAKRIA', '550025557', 'true', 280000, 0),
(302, 'SEMAAN ABDERHMAN', '550025557', 'true', 234000, 0),
(303, 'KEDDOUR WASSIM', '559155851', 'true', 262000, 0),
(304, 'CHIBAN MD AMINE', '658705242', 'true', 280000, 0),
(305, 'ZOUBIRI MED READ', '552088865', 'true', 382000, 0),
(306, 'TERCHI AMIR', '697812489', 'true', 342000, 0),
(307, 'LEGRAA YOUCEF', '776342400', 'true', 219000, 0),
(308, 'LOUIHIB LINA', '790075443', 'true', 260000, 0),
(309, 'CHEBBA IYAD MED', '661601974', 'true', 222000, 0),
(310, 'HELOUAN LINE', '555062815', 'true', 267000, 0),
(311, 'CHAREF ISHAK', '542073374', 'true', 215000, 0),
(312, 'CHAREF YACOBE', '542073374', 'true', 320000, 0),
(313, 'ALLILI SIDALI', '552943257', 'true', 435000, 0),
(314, 'ALLILI AYMEN', '552943257', 'true', 417000, 0),
(315, 'AOUHIB MED AMIR', '772702518', 'true', 260000, 0),
(316, 'SAIBI SIRINE', '553691234', 'true', 390000, 0),
(317, 'SAIBI NIHAL', '553691234', 'true', 410000, 0),
(318, 'SAIBI ISLEM', '553691234', 'true', 315000, 0),
(319, 'OUARDAN AYA', '773662278', 'true', 295000, 0),
(320, 'OUARDAN FATIMA', '773662278', 'true', 302000, 0),
(321, 'HADARBACH IMAD', '794098124', 'true', 180000, 0),
(322, 'DJEEDI ADEM', '553851162', 'true', 295000, 0),
(323, 'DJEEDI ZAKRIA', '553851162', 'true', 340000, 0),
(324, 'DJEEDI AHLAM', '553851162', 'true', 350000, 0),
(325, 'DJEDDI HAMEZA', '553851162', 'true', 175000, 0),
(326, 'TAKI ADEM', '557676156', 'true', 375000, 0),
(327, 'ZIANI MED', '770561279', 'true', 430000, 0),
(328, 'ZIANI MAHA', '770561279', 'true', 400000, 0),
(329, 'ZIANI ABDERAOUF', '770561279', 'true', 385000, 0),
(330, 'BOUHAMADOUCH RAIHANA', '554262372', 'true', 227000, 0),
(331, 'ALIOUAT ADEM', '671324234', 'true', 233500, 0),
(332, 'DJENAN ACIL', '555616886', 'true', 298000, 0),
(333, 'DJENAN DJAOUAD', '555616886', 'true', 230000, 0),
(334, 'HABET ABDLMOUMEN', '553823131', 'true', 380000, 0),
(335, 'HERACHE ABDELALI', '550112016', 'true', 285000, 0),
(336, 'HAROUN ANIA', '772214747', 'true', 265000, 0),
(337, 'KAHIA MALAK', '669838940', 'true', 329000, 0),
(338, 'TIZAROUINE YACINE', '770766694', 'true', 339800, 0),
(339, 'TIZAROUINE ABDERAOUF', '770766694', 'true', 269800, 0),
(340, 'TIZAROUIN MAROUA', '770766694', 'true', 265400, 0),
(341, 'HEMDANI ADEM', '662790222', 'true', 332000, 0),
(342, 'HEMDANI AYMEN', '662790222', 'true', 417000, 0),
(343, 'MERABET SOHAIB', '540688715', 'true', 315000, 0),
(344, 'DAHMANI FARES', '661483646', 'true', 333000, 8000),
(345, 'SIFI ZINEB', '552777071', 'true', 245000, 0),
(346, 'ZAMMOUM AMIR', '659702099', 'true', 285000, 0),
(347, 'ELAOUAR LOUDJAIN', '', 'true', 410000, 0),
(348, 'ELAOUAR TASSNIM', '', 'true', 425000, 0),
(349, 'ELAOUAR SAID', '', 'true', 320000, 0),
(350, 'YAHYAOUI RAYAN', '559503777', 'true', 432000, 0),
(351, 'TICHAT YANIS', '550365096', 'true', 337000, 0),
(352, 'TICHAT AMIR', '550365096', 'true', 280000, 0),
(353, 'OUAAMRI ARIS', '553877525', 'true', 238500, 0),
(354, 'AMMI AYOUB', '781820923', 'true', 380000, 0),
(355, 'CHARIF YAHIA', '551826033', 'true', 363000, 0),
(356, 'CHARIF MED AMINE', '551826033', 'true', 370000, 0),
(357, 'AZOUAOU HAACEN', '661650159', 'true', 345000, 0),
(358, 'AZOUAOU ANIA', '661650159', 'true', 355000, 0),
(359, 'BENCHABLA ZAKRIA', '770419912', 'true', 275000, 0),
(360, 'BENCHABLA HIBA', '770419912', 'true', 350000, 0),
(361, 'ABDOUNI TASSNIM', '790987447', 'true', 298000, 0),
(362, 'HAROUN MED', '772214747', 'true', 355000, 0),
(363, 'CHARIF ABDERHIM', '555528470', 'true', 295000, 0),
(364, 'CHARIF ADEM', '555528470', 'true', 249000, 0),
(365, 'BENTRKIA MED', '773201301', 'true', 288000, 0),
(366, 'ZAIDI IMANE', '670149788', 'true', 288000, 0),
(367, 'METTCHAT AHMED ABDERAOUF', '661650777', 'true', 388000, 0),
(368, 'MIRABET OUSSAMA', '540688715', 'true', 382000, 0),
(369, 'MIRABET ABDELHAI', '540688715', 'true', 355000, 0),
(370, 'MANSOURI AYLAN', '555350405', 'true', 285000, 0),
(371, 'TELAILIA ZAID', '657115721', 'true', 175000, 0),
(372, 'LAKEHAL MED YACINE', '667123389', 'true', 230000, 0),
(373, 'LAKEHAL MED AMINE', '667123389', 'true', 275000, 0),
(374, 'SEMANI IYAD', '553905718', 'true', 260000, 0),
(375, 'SEMANI IDIR', '553905718', 'true', 280000, 0),
(376, 'SIDALI ASIREM', '551820788', 'true', 352000, 0),
(377, 'SIDALI MED RACHID', '551820788', 'true', 222000, 0),
(378, 'KACIMI MALAK', '696845941', 'true', 327000, 0),
(379, 'KACIMI YANICE', '696845941', 'true', 227000, 0),
(380, 'BENMRZOUGA AMIRA', '557006669', 'true', 402000, 0),
(381, 'BENMRZOUGA RAFIF AFNAN', '557006669', 'true', 292000, 0),
(382, 'BENDALI MEREIM', '555581005', 'true', 270000, 0),
(383, 'KEHILI LINA', '558888180', 'true', 215500, 0),
(384, 'KEHILI AGHILES', '558888180', 'true', 285000, 0),
(385, 'KEHILI SALIHA', '558888180', 'true', 235000, 0),
(386, 'LADOUL MED', '557022099', 'true', 285000, 0),
(387, 'YOUCEFI AYA', '541981748', 'true', 215000, 0),
(388, 'YOUCEFI SARA', '541981748', 'true', 259000, 0),
(389, 'YOUCEFI ANES', '541981748', 'true', 325000, 0),
(390, 'BOUABDELLAH TOUBA', '661350061', 'true', 345500, 0),
(391, 'BOUABDELLAH MOURAD', '661350061', 'true', 315000, 0);

  -- Map workbook rows to live students.
  --   tier 1: exact name + parent phone match (disambiguates the two
  --           same-named SIDI MAMER SAMYI students);
  --   tier 2: unique corpus name matched by name alone (covers rows whose
  --           phone was mangled at import or is absent).
  CREATE TEMP TABLE _t105_map AS
  WITH t1 AS (
    SELECT c.xl_row, s.id AS student_id, s.parent_id
    FROM _t105_corpus c
    JOIN students s ON upper(regexp_replace(s.display_name, '\s+', ' ', 'g')) = c.xl_name
    JOIN parents p ON p.id = s.parent_id
    WHERE s.deleted_at IS NULL AND p.deleted_at IS NULL
      AND c.xl_phone <> ''
      AND regexp_replace(regexp_replace(p.primary_phone, '[^0-9]', '', 'g'), '^0+', '', '') = c.xl_phone
    ORDER BY c.xl_row, s.created_at
  ), t1_rows AS (SELECT DISTINCT xl_row FROM t1)
  SELECT c.xl_row, s.id AS student_id, s.parent_id
  FROM _t105_corpus c
  JOIN students s ON upper(regexp_replace(s.display_name, '\s+', ' ', 'g')) = c.xl_name
  JOIN parents p ON p.id = s.parent_id
  WHERE s.deleted_at IS NULL AND p.deleted_at IS NULL
    AND c.xl_unique
    AND c.xl_row NOT IN (SELECT xl_row FROM t1_rows)
  UNION ALL
  SELECT xl_row, student_id, parent_id FROM t1;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 1 — DATA-010: cancel the double-remise adjustments.
  -- One compensating +|amount| adjustment per imported REMISE entry
  -- (append-only: the original stays as forensic history).
  -- ══════════════════════════════════════════════════════════════════════
  INSERT INTO ledger_entries (entry_number, tenant_id, account_id, parent_id,
    student_id, category, amount, entry_type, source_type, source_id,
    method, receipt_number, payment_status, reverses_id, description,
    actor_id, actor_name, at, metadata)
  SELECT
    'led-recon0063-remise-' || le.id,
    v_tenant,
    le.account_id,
    le.parent_id,
    le.student_id,
    le.category,
    -le.amount,
    'adjustment',
    'bulk_import',
    le.source_id || ':RECON0063',
    NULL, NULL, NULL, NULL,
    'Annulation double-remise (réconciliation 0063) — le devis importé est déjà net de remise (formule Excel L = composantes − J)',
    NULL, 'Réconciliation 0063',
    le.at,
    JSONB_BUILD_OBJECT('reconciliation', '0063', 'reason', 'double_remise_cancel',
      'original_entry', le.id, 'original_amount', le.amount)
  FROM ledger_entries le
  WHERE le.tenant_id = v_tenant
    AND le.entry_type = 'adjustment'
    AND le.reverses_id IS NULL
    AND le.source_type = 'bulk_import'
    AND le.description LIKE 'Remise sur devis%'
    AND le.amount < 0
    AND NOT EXISTS (
      SELECT 1 FROM ledger_entries x
      WHERE x.tenant_id = v_tenant
        AND x.source_type = 'bulk_import'
        AND x.source_id = le.source_id || ':RECON0063'
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_comp_rows = ROW_COUNT;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 2 — DATA-011: create the missing row-242 family.
  -- Parent 0554288142 / student 'SIDI MAMER SAMYI' (5AP) / devis 255,000 /
  -- payments V2 75,000 + 2V 90,000 + v3 90,000 = 255,000 / créance 0.
  -- Shapes mirror the import (tranches from the 5ap grid × remise ratio:
  -- 300,000 − 45,000 remise → 102,000 / 76,500 / 76,500 = 255,000 exactly).
  -- ══════════════════════════════════════════════════════════════════════
  IF NOT EXISTS (SELECT 1 FROM parents WHERE tenant_id = v_tenant
                 AND regexp_replace(primary_phone, '[^0-9]', '', 'g') = '0554288142') THEN
    INSERT INTO parents (id, tenant_id, parent_code, first_name, last_name,
      display_name, primary_phone, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant,
      'PAR-2026-' || upper(substr(md5('0063-mamer-242-parent'), 1, 6)),
      '', 'SIDI', 'SIDI MAMER SAMYI', '0554288142', true, NOW(), NOW())
    RETURNING id INTO v_new_parent;
    v_created_parent := 1;

    INSERT INTO students (id, tenant_id, parent_id, student_code, first_name,
      last_name, display_name, grade_level_code, grade_level_id, class_id,
      payment_plan, enrollment_status, is_active, date_of_birth, created_at,
      updated_at)
    VALUES (gen_random_uuid(), v_tenant, v_new_parent,
      'ELV-2026-' || upper(substr(md5('0063-mamer-242-student'), 1, 6)),
      'MAMER SAMYI', 'SIDI', 'SIDI MAMER SAMYI', '5ap',
      (SELECT id FROM academic_levels WHERE grade_code = '5ap' LIMIT 1),
      (SELECT class_id FROM students WHERE student_code = 'ELV-2026-9C53E3' LIMIT 1),
      'tranches', 'active', true, '2000-01-01', NOW(), NOW())
    RETURNING id INTO v_new_student;
    v_created_student := 1;

    -- tranches (5ap grid net of remise: 102,000 / 76,500 / 76,500)
    INSERT INTO installments (id, tenant_id, parent_id, student_id, category,
      tranche_number, label, amount_due, amount_paid, amount_pending,
      due_date, paid_date, status, academic_cycle, payment_plan,
      is_custom_schedule, custom_schedule_note, created_at, updated_at)
    VALUES
      (gen_random_uuid(), v_tenant, v_new_parent, v_new_student, 'tuition', 1,
       'Tranche 1 — Scolarité', 102000, 0, 0, '2025-09-15', NULL, 'unpaid',
       'primaire', 'tranches', false, NULL, NOW(), NOW()),
      (gen_random_uuid(), v_tenant, v_new_parent, v_new_student, 'tuition', 2,
       'Tranche 2 — Scolarité', 76500, 0, 0, '2025-12-15', NULL, 'unpaid',
       'primaire', 'tranches', false, NULL, NOW(), NOW()),
      (gen_random_uuid(), v_tenant, v_new_parent, v_new_student, 'tuition', 3,
       'Tranche 3 — Scolarité', 76500, 0, 0, '2026-03-15', NULL, 'unpaid',
       'primaire', 'tranches', false, NULL, NOW(), NOW());
    v_created_tranches := 3;

    -- ledger: one devis charge (NET — no remise adjustment: the workbook's
    -- L already nets it) + three payment entries
    INSERT INTO ledger_entries (entry_number, tenant_id, account_id, parent_id,
      student_id, category, amount, entry_type, source_type, source_id,
      method, receipt_number, payment_status, reverses_id, description,
      actor_id, actor_name, at, metadata)
    VALUES
      ('led-recon0063-devis-' || v_new_student, v_tenant,
       'parent:' || v_new_parent || ':category:tuition:student:' || v_new_student,
       v_new_parent, v_new_student, 'tuition', 255000, 'charge',
       'bulk_import', v_new_student || ':DEVIS_ANNUEL',
       NULL, NULL, NULL, NULL,
       'Devis annuel (réconciliation 0063 — ligne 242 du classeur source, non importée le 2026-08-11)',
       NULL, 'Réconciliation 0063', '2026-08-11T12:00:00Z',
       JSONB_BUILD_OBJECT('reconciliation', '0063', 'excel_row', 242)),
      ('led-recon0063-pay-' || v_new_student || '-V2', v_tenant,
       'parent:' || v_new_parent || ':category:tuition:student:' || v_new_student,
       v_new_parent, v_new_student, 'tuition', -75000, 'payment',
       'bulk_import', v_new_student || ':V2',
       'cash', 'IMP-' || v_new_student || '-V2', 'paid', NULL,
       'Versement 2 (V2) — réconciliation 0063, ligne 242',
       NULL, 'Réconciliation 0063', '2026-08-11T12:00:00Z',
       JSONB_BUILD_OBJECT('reconciliation', '0063', 'excel_row', 242)),
      ('led-recon0063-pay-' || v_new_student || '-V2_ALT', v_tenant,
       'parent:' || v_new_parent || ':category:tuition:student:' || v_new_student,
       v_new_parent, v_new_student, 'tuition', -90000, 'payment',
       'bulk_import', v_new_student || ':V2_ALT',
       'cash', 'IMP-' || v_new_student || '-V2_ALT', 'paid', NULL,
       'Versement 2 alternatif (2V) — réconciliation 0063, ligne 242',
       NULL, 'Réconciliation 0063', '2026-08-11T12:00:00Z',
       JSONB_BUILD_OBJECT('reconciliation', '0063', 'excel_row', 242)),
      ('led-recon0063-pay-' || v_new_student || '-V3', v_tenant,
       'parent:' || v_new_parent || ':category:tuition:student:' || v_new_student,
       v_new_parent, v_new_student, 'tuition', -90000, 'payment',
       'bulk_import', v_new_student || ':V3',
       'cash', 'IMP-' || v_new_student || '-V3', 'paid', NULL,
       'Versement 3 (v3) — réconciliation 0063, ligne 242',
       NULL, 'Réconciliation 0063', '2026-08-11T12:00:00Z',
       JSONB_BUILD_OBJECT('reconciliation', '0063', 'excel_row', 242));

    -- payments rows (payment_number == receipt convention of the import)
    INSERT INTO payments (id, tenant_id, payment_number, parent_id, student_id,
      installment_id, amount, method, status, category, collected_at,
      collected_by, notes, receipt_number, created_at, updated_at)
    VALUES
      (gen_random_uuid(), v_tenant, 'IMP-' || v_new_student || '-V2',
       v_new_parent, v_new_student, NULL, 75000, 'cash', 'paid', 'tuition',
       '2026-08-11T12:00:00Z', NULL,
       'Versement 2 (V2) — import Excel ligne 242 (réconciliation 0063)',
       'IMP-' || v_new_student || '-V2', NOW(), NOW()),
      (gen_random_uuid(), v_tenant, 'IMP-' || v_new_student || '-V2_ALT',
       v_new_parent, v_new_student, NULL, 90000, 'cash', 'paid', 'tuition',
       '2026-08-11T12:00:00Z', NULL,
       'Versement 2 alternatif (2V) — import Excel ligne 242 (réconciliation 0063)',
       'IMP-' || v_new_student || '-V2_ALT', NOW(), NOW()),
      (gen_random_uuid(), v_tenant, 'IMP-' || v_new_student || '-V3',
       v_new_parent, v_new_student, NULL, 90000, 'cash', 'paid', 'tuition',
       '2026-08-11T12:00:00Z', NULL,
       'Versement 3 (v3) — import Excel ligne 242 (réconciliation 0063)',
       'IMP-' || v_new_student || '-V3', NOW(), NOW());
    v_created_payments := 3;

    INSERT INTO audit_logs (id, tenant_id, action, entity_type, entity_id,
      actor_id, actor_name, actor_role, before_json, after_json, note, created_at)
    VALUES (gen_random_uuid(), v_tenant, 'crm.reconcile_missing_row', 'parent',
      v_new_parent, NULL, 'Réconciliation 0063', 'system', NULL,
      JSONB_BUILD_OBJECT('excel_row', 242, 'student_id', v_new_student,
        'devis', 255000, 'payments', 255000, 'creance', 0,
        'phone', '0554288142'),
      'DATA-011: la ligne 242 du classeur (SIDI MAMER SAMYI, tél 0554288142, 5AP) n''a jamais été importée — collision d''identité avec l''élève homonyme du parent 0550067500. Famille recréée exactement selon le classeur: devis 255 000, versements 255 000, créance 0.',
      NOW());
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 3 — per-student alignment to the workbook devis.
  -- target = xl_devis + xl_dettes; ledger adjustment absorbs
  -- (target − current netdue); installments absorb
  -- (target − Σ amount_due) via the last-tranche rule (0062 precedent),
  -- cascading backwards for negative deltas.
  -- ══════════════════════════════════════════════════════════════════════
  FOR v_stu IN
    SELECT m.student_id, m.parent_id, m.xl_row, c.xl_name,
      c.xl_devis + c.xl_dettes AS target,
      COALESCE((SELECT SUM(le.amount) FROM ledger_entries le
        WHERE le.tenant_id = v_tenant AND le.student_id = m.student_id
          AND le.reverses_id IS NULL
          AND le.entry_type IN ('charge', 'adjustment')), 0) AS netdue,
      COALESCE((SELECT SUM(i.amount_due) FROM installments i
        WHERE i.tenant_id = v_tenant AND i.student_id = m.student_id), 0) AS ins_due
    FROM _t105_map m
    JOIN _t105_corpus c ON c.xl_row = m.xl_row
    WHERE m.student_id IS NOT NULL
    ORDER BY m.xl_row
  LOOP
    v_target := round(v_stu.target);
    v_delta := v_target - v_stu.netdue;
    IF abs(v_delta) >= 0.5 THEN
      INSERT INTO ledger_entries (entry_number, tenant_id, account_id, parent_id,
        student_id, category, amount, entry_type, source_type, source_id,
        method, receipt_number, payment_status, reverses_id, description,
        actor_id, actor_name, at, metadata)
      VALUES ('led-recon0063-align-' || v_stu.student_id, v_tenant,
        'parent:' || v_stu.parent_id || ':category:tuition:student:' || v_stu.student_id,
        v_stu.parent_id, v_stu.student_id, 'tuition', v_delta, 'adjustment',
        'bulk_import', v_stu.student_id || ':DEVIS_ALIGN_0063',
        NULL, NULL, NULL, NULL,
        'Alignement devis Excel (réconciliation 0063, ligne ' || v_stu.xl_row || ') — '
          || trim(to_char(v_delta, 'FM999999999')) || ' DZD',
        NULL, 'Réconciliation 0063', NOW(),
        JSONB_BUILD_OBJECT('reconciliation', '0063', 'excel_row', v_stu.xl_row,
          'target', v_target, 'delta', v_delta))
      ON CONFLICT DO NOTHING;
      v_align_rows := v_align_rows + 1;
    END IF;

    -- installment side
    v_ins_delta := v_target - v_stu.ins_due;
    IF abs(v_ins_delta) >= 0.5 THEN
      IF v_ins_delta > 0 THEN
        -- positive: extend the LAST tuition tranche (or create one)
        SELECT id, amount_due INTO v_ins FROM installments
        WHERE tenant_id = v_tenant AND student_id = v_stu.student_id
          AND category = 'tuition'
        ORDER BY due_date DESC, tranche_number DESC, id DESC
        LIMIT 1;
        IF v_ins.id IS NOT NULL THEN
          UPDATE installments SET amount_due = amount_due + v_ins_delta,
            updated_at = NOW() WHERE id = v_ins.id;
          v_absorb_rows := v_absorb_rows + 1;
        ELSE
          INSERT INTO installments (id, tenant_id, parent_id, student_id,
            category, tranche_number, label, amount_due, amount_paid,
            amount_pending, due_date, paid_date, status, academic_cycle,
            payment_plan, is_custom_schedule, custom_schedule_note,
            created_at, updated_at)
          VALUES (gen_random_uuid(), v_tenant, v_stu.parent_id, v_stu.student_id,
            'tuition', 1, 'Tranche 1 — Scolarité', v_ins_delta, 0, 0,
            '2026-03-15', NULL, 'unpaid', 'primaire', 'tranches', false,
            'Tranche créée par la réconciliation 0063 (aucune tranche à l''import).',
            NOW(), NOW());
          v_absorb_rows := v_absorb_rows + 1;
        END IF;
      ELSE
        -- negative: reduce tranches from the LAST backwards, floor 0
        v_absorb_left := -v_ins_delta;
        FOR v_ins IN SELECT id, amount_due FROM installments
          WHERE tenant_id = v_tenant AND student_id = v_stu.student_id
          ORDER BY category DESC, due_date DESC, tranche_number DESC, id DESC
        LOOP
          EXIT WHEN v_absorb_left <= 0;
          v_take := LEAST(v_ins.amount_due, v_absorb_left);
          IF v_take > 0 THEN
            UPDATE installments SET amount_due = amount_due - v_take,
              updated_at = NOW() WHERE id = v_ins.id;
            v_absorb_left := v_absorb_left - v_take;
            v_absorb_rows := v_absorb_rows + 1;
          END IF;
        END LOOP;
        IF v_absorb_left >= 0.5 THEN
          RAISE EXCEPTION '0063: student % negative absorption incomplete (%)',
            v_stu.student_id, v_absorb_left;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 4 — waterfall replay (0062 STEP 5 + explicit allocation DELETE).
  -- amount_paid / payment_allocations are derived caches; the ledger and
  -- payments table are the system of record.
  -- ══════════════════════════════════════════════════════════════════════
  DELETE FROM payment_allocations WHERE tenant_id = v_tenant;

  UPDATE installments
     SET amount_paid = 0, amount_pending = 0, paid_date = NULL,
         status = CASE WHEN amount_due > 0 THEN 'unpaid' ELSE status END,
         updated_at = NOW()
   WHERE tenant_id = v_tenant
     AND (amount_paid > 0 OR amount_pending > 0 OR paid_date IS NOT NULL
          OR status IN ('paid', 'partial', 'pending_clearance'));
  GET DIAGNOSTICS v_reset_rows = ROW_COUNT;

  FOR v_parent IN SELECT DISTINCT parent_id FROM payments
                  WHERE tenant_id = v_tenant
                    AND status NOT IN ('refunded', 'cancelled')
                  ORDER BY parent_id
  LOOP
    FOR v_cat IN SELECT DISTINCT category FROM payments
                 WHERE tenant_id = v_tenant AND parent_id = v_parent.parent_id
                   AND status NOT IN ('refunded', 'cancelled')
    LOOP
      FOR v_pay IN SELECT * FROM payments
                   WHERE tenant_id = v_tenant
                     AND parent_id = v_parent.parent_id
                     AND category = v_cat
                     AND status NOT IN ('refunded', 'cancelled')
                   ORDER BY collected_at ASC, id ASC
      LOOP
        v_remaining := v_pay.amount;
        v_alloc_count := 0;
        v_single_target := NULL;

        FOR v_ins IN
          SELECT i.id, i.label, i.amount_due, i.amount_paid,
                 COALESCE(i.amount_pending, 0) AS amount_pending,
                 GREATEST(0, i.amount_due - i.amount_paid - COALESCE(i.amount_pending, 0)) AS ins_remaining
          FROM installments i
          WHERE i.tenant_id = v_tenant
            AND i.parent_id = v_pay.parent_id
            AND i.category = v_pay.category
            AND GREATEST(0, i.amount_due - i.amount_paid - COALESCE(i.amount_pending, 0)) > 0
          ORDER BY i.due_date ASC, i.id ASC
        LOOP
          EXIT WHEN v_remaining <= 0;
          v_ins_remaining := v_ins.ins_remaining;
          v_allocate := LEAST(v_remaining, v_ins_remaining);
          IF v_allocate > 0 THEN
            v_new_paid := v_ins.amount_paid + v_allocate;
            IF v_new_paid >= v_ins.amount_due THEN v_new_status := 'paid';
            ELSE v_new_status := 'partial'; END IF;
            UPDATE installments
               SET amount_paid = amount_paid + v_allocate,
                   status = v_new_status,
                   paid_date = CASE WHEN v_new_status = 'paid'
                                    THEN COALESCE(paid_date, v_pay.collected_at)
                                    ELSE paid_date END,
                   updated_at = NOW()
             WHERE id = v_ins.id;
            INSERT INTO payment_allocations (id, tenant_id, payment_id,
              charge_id, installment_id, category, allocated_amount, label, created_at)
            VALUES (gen_random_uuid(), v_tenant, v_pay.id, NULL, v_ins.id,
              v_pay.category, v_allocate, v_ins.label, NOW());
            v_remaining := v_remaining - v_allocate;
            v_alloc_count := v_alloc_count + 1;
            v_single_target := v_ins.id;
          END IF;
        END LOOP;

        UPDATE payments
           SET expected_amount = v_pay.amount - v_remaining,
               excess_amount = v_remaining,
               excess_remark = CASE WHEN v_remaining > 0
                 THEN 'Réconciliation 0063 — excédent (crédit parent)'
                 ELSE NULL END,
               installment_id = CASE
                 WHEN v_alloc_count = 1 AND v_remaining <= 0 THEN v_single_target
                 ELSE installment_id END,
               updated_at = NOW()
         WHERE id = v_pay.id;
        v_alloc_rows := v_alloc_rows + v_alloc_count;
        v_pay_rows := v_pay_rows + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 5 — reconciliation summary audit entry (idempotency marker).
  -- ══════════════════════════════════════════════════════════════════════
  INSERT INTO audit_logs (id, tenant_id, action, entity_type, entity_id,
    actor_id, actor_name, actor_role, before_json, after_json, note, created_at)
  VALUES (gen_random_uuid(), v_tenant, 'financial.reconcile_0063', 'payment',
    NULL, NULL, 'Réconciliation 0063', 'system',
    JSONB_BUILD_OBJECT('remise_adjustments_cancelled', v_comp_rows),
    JSONB_BUILD_OBJECT('parents_created', v_created_parent,
      'students_created', v_created_student,
      'tranches_created', v_created_tranches,
      'payments_created', v_created_payments,
      'devis_alignments', v_align_rows,
      'tranche_absorptions', v_absorb_rows,
      'installments_reset', v_reset_rows,
      'payments_replayed', v_pay_rows,
      'allocations_written', v_alloc_rows),
    'T-105 / DATA-010+DATA-011+DATA-003(residuels): alignement du corpus sur le classeur source (390 lignes). Annulation de la double-remise (223 parents), création de la famille ligne 242 (255 000 DZD), alignement des devis par élève, rejeu complet de la cascade. Vérification: scripts/verify_t-105.sql.',
    NOW());

  RAISE NOTICE '0063 alignment complete: remise-cancelled=%, parents-created=%, students-created=%, devis-alignments=%, tranche-absorptions=%, installments-reset=%, payments-replayed=%, allocations=%',
    v_comp_rows, v_created_parent, v_created_student, v_align_rows, v_absorb_rows, v_reset_rows, v_pay_rows, v_alloc_rows;

  DROP TABLE _t105_corpus;
  DROP TABLE _t105_map;
END $$;
