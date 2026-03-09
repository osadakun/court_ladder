-- v2.6 テストデータ: シングルス40人 + ダブルス60人(30ペア)
-- コート1-7: シングルス / コート8-10: ダブルス
DO $$
DECLARE
  tid UUID := '6d7cbdac-ff8d-4363-82f1-3b8b4dcf749e';
  team_ids UUID[] := '{}';
  t_id UUID;
  m_id UUID;
  m_id2 UUID;
  e_id UUID;
  i INT;
  grade_val TEXT;
  court_no_val INT;
  tnames TEXT[] := ARRAY['レッド', 'ブルー', 'グリーン', 'イエロー', 'パープル'];
  tcolors TEXT[] := ARRAY['#EF4444', '#3B82F6', '#22C55E', '#EAB308', '#A855F7'];
  -- シングルス40人分の名前
  s_names TEXT[] := ARRAY[
    '佐藤 太郎','鈴木 次郎','高橋 三郎','田中 花子','伊藤 健太',
    '渡辺 翔太','山本 大輔','中村 直樹','小林 拓也','加藤 達也',
    '吉田 隆','山田 誠','松本 亮','井上 涼','木村 純',
    '林 茂','斎藤 勇','清水 進','山口 修','池田 豊',
    '橋本 剛','阿部 学','石川 博','山崎 正','森 明',
    '藤田 光','岡田 実','後藤 清','長谷川 浩','石井 哲',
    '村上 聡','近藤 悟','坂本 真一','遠藤 洋一','青木 幸一',
    '藤井 雄一','西村 信一','福田 和也','太田 竜也','三浦 圭'
  ];
  s_grades TEXT[] := ARRAY[
    '中3','中2','中1','小6','小5',
    '中3','中2','中1','小6','小5',
    '中3','中2','中1','小4','小3',
    '中3','中2','中1','小6','小5',
    '大人','中3','中2','中1','小6',
    '小5','小4','小3','小2','小1',
    '中3','中2','中1','小6','小5',
    '中3','中2','中1','年長','大人'
  ];
  -- ダブルス60人分の名前（30ペア、2人ずつ）
  d_names TEXT[] := ARRAY[
    '岡本 智','松田 仁','中川 義','中野 忠','原田 孝',
    '小野 敬','田村 慎','竹内 恵','金子 優','和田 愛',
    '中山 望','石田 歩','上田 翼','森田 陸','小島 海',
    '柴田 空','原 風','宮崎 光','酒井 月','工藤 星',
    '横山 龍','宮本 虎','内田 鶴','高木 亀','安藤 桜',
    '谷口 梅','大野 菊','丸山 蘭','今井 椿','藤原 葵',
    '永井 翔','平野 瞬','菅原 響','木下 凜','杉山 暖',
    '久保 陽','野口 匠','松井 蓮','佐々木 凛','水野 萌',
    '小山 輝','河野 絆','古川 颯','前田 朝','新井 夕',
    '吉川 昴','高田 芽','片山 碧','武田 紬','秋山 澪',
    '土井 健','飯田 勲','堀 義人','浜田 誠治','大西 和樹',
    '藤本 光一','北村 大地','星野 航','望月 徹','関口 淳'
  ];
  d_grades TEXT[] := ARRAY[
    '中3','中2','中1','小6','小5',
    '中3','中2','中1','小6','小5',
    '小4','小3','小2','小1','年長',
    '大人','中3','中2','中1','小6',
    '小5','小4','小3','小2','小1',
    '中3','中2','中1','小6','小5',
    '大人','中3','中2','中1','小6',
    '小5','小4','小3','小2','小1',
    '中3','中2','中1','小6','小5',
    '中3','中2','中1','小4','小3',
    '大人','中3','中2','中1','小6',
    '小5','小4','小3','小2','小1'
  ];
BEGIN
  -- 既存データ削除（tournament_id に紐づく全データ）
  DELETE FROM movement_logs WHERE tournament_id = tid;
  DELETE FROM audit_logs WHERE tournament_id = tid;
  DELETE FROM queue_items WHERE tournament_id = tid;
  DELETE FROM matches WHERE tournament_id = tid;
  DELETE FROM entry_members WHERE tournament_id = tid;
  DELETE FROM entries WHERE tournament_id = tid;
  DELETE FROM members WHERE tournament_id = tid;
  DELETE FROM courts WHERE tournament_id = tid;
  DELETE FROM teams WHERE tournament_id = tid;

  -- 大会設定を v2.6 仕様に更新
  UPDATE tournaments SET
    singles_court_count = 7,
    doubles_court_count = 3,
    allow_same_team_match = true,
    revision = 1
  WHERE tournament_id = tid;

  -- コート作成（シングルス 1-7, ダブルス 8-10）
  FOR i IN 1..7 LOOP
    INSERT INTO courts (tournament_id, court_no, court_type, status)
    VALUES (tid, i, 'singles', 'active');
  END LOOP;
  FOR i IN 8..10 LOOP
    INSERT INTO courts (tournament_id, court_no, court_type, status)
    VALUES (tid, i, 'doubles', 'active');
  END LOOP;

  -- チーム作成
  FOR i IN 1..5 LOOP
    INSERT INTO teams (tournament_id, team_name, color_code, sort_order)
    VALUES (tid, tnames[i], tcolors[i], i)
    RETURNING team_id INTO t_id;
    team_ids := array_append(team_ids, t_id);
  END LOOP;

  -- ===== シングルス40人 =====
  -- 初期コートはラウンドロビンで1-7に配分
  FOR i IN 1..40 LOOP
    grade_val := s_grades[i];
    court_no_val := ((i - 1) % 7) + 1;

    INSERT INTO members (tournament_id, management_name, grade)
    VALUES (tid, s_names[i], grade_val)
    RETURNING member_id INTO m_id;

    INSERT INTO entries (tournament_id, entry_type, team_id, initial_court_no)
    VALUES (tid, 'singles', team_ids[((i-1) % 5) + 1], court_no_val)
    RETURNING entry_id INTO e_id;

    INSERT INTO entry_members (tournament_id, entry_id, member_id, member_order)
    VALUES (tid, e_id, m_id, 1);
  END LOOP;

  -- ===== ダブルス30ペア（60人） =====
  -- 初期コートはラウンドロビンで8-10に配分
  FOR i IN 1..30 LOOP
    court_no_val := ((i - 1) % 3) + 8;

    -- メンバー1
    INSERT INTO members (tournament_id, management_name, grade)
    VALUES (tid, d_names[(i-1)*2 + 1], d_grades[(i-1)*2 + 1])
    RETURNING member_id INTO m_id;

    -- メンバー2
    INSERT INTO members (tournament_id, management_name, grade)
    VALUES (tid, d_names[(i-1)*2 + 2], d_grades[(i-1)*2 + 2])
    RETURNING member_id INTO m_id2;

    INSERT INTO entries (tournament_id, entry_type, team_id, initial_court_no)
    VALUES (tid, 'doubles', team_ids[((i-1) % 5) + 1], court_no_val)
    RETURNING entry_id INTO e_id;

    INSERT INTO entry_members (tournament_id, entry_id, member_id, member_order)
    VALUES (tid, e_id, m_id, 1);
    INSERT INTO entry_members (tournament_id, entry_id, member_id, member_order)
    VALUES (tid, e_id, m_id2, 2);
  END LOOP;

  RAISE NOTICE 'Created: 40 singles + 30 doubles pairs (60 members) for テスト大会2 (v2.6)';
END;
$$;
