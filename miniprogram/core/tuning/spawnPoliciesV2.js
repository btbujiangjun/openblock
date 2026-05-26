/**
 * 小程序运行时数据模块 — 出块寻参 v2 策略 (离线包)
 * 自动生成于: 2026-05-26 19:48:42
 * 模型 ID: 22 · SHA-256: 9cd86a070f9df41b31ec7e70d613ab305962f819ff445f1168a6aa35ffe77266
 * 策略数: 360 · 灰度: 100%
 * 构建模式: model-inference (default theta=0.5)
 * 平均 calibrated MAE: 0.1115
 */
module.exports = {
  "format": "openblock-spawn-tuning-v2-bundle",
  "version": "2.0.0",
  "n_contexts": 360,
  "generated_at": 1779796122,
  "model_id": 22,
  "model_sha256": "9cd86a070f9df41b31ec7e70d613ab305962f819ff445f1168a6aa35ffe77266",
  "rollout_pct": 100,
  "policies": [
    {
      "context_key": "easy:triplet-p1:random:500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.43689395984013873,
        0.43689395984013873,
        0.43689395984013873,
        0.5070479512214661,
        0.525451123714447,
        0.5518056750297546,
        0.589049756526947,
        0.6233072280883789,
        0.6652929186820984,
        0.7119088768959045,
        0.7478881478309631,
        0.7848240733146667,
        0.7999671697616577,
        0.8391816020011902,
        0.8471082448959351,
        0.8501042127609253,
        0.871234118938446,
        0.8728144466876984,
        0.8728144466876984,
        0.8734946846961975
      ],
      "expected": {
        "calibrated_mae": 0.082533
      }
    },
    {
      "context_key": "easy:triplet-p1:random:500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4483489692211151,
        0.4483489692211151,
        0.4483489692211151,
        0.517928957939148,
        0.5366250872612,
        0.5626210570335388,
        0.6001596450805664,
        0.633927047252655,
        0.6752581596374512,
        0.7200810313224792,
        0.7549865245819092,
        0.7900726795196533,
        0.8043022155761719,
        0.8419296145439148,
        0.8496254086494446,
        0.852652370929718,
        0.8724899888038635,
        0.8741804361343384,
        0.8741804361343384,
        0.8747769594192505
      ],
      "expected": {
        "calibrated_mae": 0.085582
      }
    },
    {
      "context_key": "easy:triplet-p1:random:500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.44067944089571637,
        0.44067944089571637,
        0.44067944089571637,
        0.5104771852493286,
        0.5290257334709167,
        0.5549225807189941,
        0.5923819541931152,
        0.6264196038246155,
        0.6680780053138733,
        0.7138241529464722,
        0.7492765188217163,
        0.7852897644042969,
        0.7999013066291809,
        0.8383488059043884,
        0.8462886810302734,
        0.8493010997772217,
        0.8699892163276672,
        0.8716618120670319,
        0.8716618120670319,
        0.8721593022346497
      ],
      "expected": {
        "calibrated_mae": 0.08425
      }
    },
    {
      "context_key": "easy:triplet-p1:random:500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4382280906041463,
        0.4382280906041463,
        0.4382280906041463,
        0.5069616436958313,
        0.5253410935401917,
        0.5514735579490662,
        0.5888282656669617,
        0.6231886148452759,
        0.6650218963623047,
        0.7111711502075195,
        0.7468006014823914,
        0.7834952473640442,
        0.7984689474105835,
        0.8378593325614929,
        0.8458779454231262,
        0.848924994468689,
        0.870030403137207,
        0.8716822266578674,
        0.8716822266578674,
        0.8724157214164734
      ],
      "expected": {
        "calibrated_mae": 0.083322
      }
    },
    {
      "context_key": "easy:triplet-p1:random:1500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4653196434179942,
        0.4653196434179942,
        0.4653196434179942,
        0.5144073367118835,
        0.5272329449653625,
        0.544883131980896,
        0.5700562000274658,
        0.5931985974311829,
        0.6211003661155701,
        0.6525106430053711,
        0.6778379678726196,
        0.7067727446556091,
        0.7184473872184753,
        0.7557621598243713,
        0.763386607170105,
        0.766136109828949,
        0.7910420894622803,
        0.7925788760185242,
        0.7925788760185242,
        0.7931309938430786
      ],
      "expected": {
        "calibrated_mae": 0.1253
      }
    },
    {
      "context_key": "easy:triplet-p1:random:1500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47101808587710065,
        0.47101808587710065,
        0.47101808587710065,
        0.5206286907196045,
        0.5338350534439087,
        0.5514847636222839,
        0.5771713852882385,
        0.6002556681632996,
        0.6282239556312561,
        0.6592190861701965,
        0.6844969391822815,
        0.7129310965538025,
        0.7242831587791443,
        0.7607507109642029,
        0.7683849930763245,
        0.7712084054946899,
        0.7949581742286682,
        0.7966095209121704,
        0.7966095209121704,
        0.7970877289772034
      ],
      "expected": {
        "calibrated_mae": 0.125373
      }
    },
    {
      "context_key": "easy:triplet-p1:random:1500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4673377772172292,
        0.4673377772172292,
        0.4673377772172292,
        0.5173779129981995,
        0.5304916501045227,
        0.5480948686599731,
        0.5737246870994568,
        0.5968852043151855,
        0.6248510479927063,
        0.6560800671577454,
        0.681341290473938,
        0.7100300192832947,
        0.7213890552520752,
        0.7580714821815491,
        0.7657395005226135,
        0.7685289978981018,
        0.7927889823913574,
        0.7944151163101196,
        0.7944151163101196,
        0.7948340773582458
      ],
      "expected": {
        "calibrated_mae": 0.125258
      }
    },
    {
      "context_key": "easy:triplet-p1:random:1500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.462545504172643,
        0.462545504172643,
        0.462545504172643,
        0.5110409259796143,
        0.5239319801330566,
        0.5415741205215454,
        0.5669633150100708,
        0.5903337001800537,
        0.6184500455856323,
        0.6500061750411987,
        0.6755623817443848,
        0.7047836184501648,
        0.7165749669075012,
        0.7543604373931885,
        0.7621506452560425,
        0.7649492621421814,
        0.7899990677833557,
        0.7915622293949127,
        0.7915622293949127,
        0.7921581864356995
      ],
      "expected": {
        "calibrated_mae": 0.124781
      }
    },
    {
      "context_key": "easy:triplet-p1:random:4000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47636497020721436,
        0.47636497020721436,
        0.47636497020721436,
        0.5168003439903259,
        0.5276714563369751,
        0.5427968502044678,
        0.5642378926277161,
        0.5846245884895325,
        0.6084865927696228,
        0.636478066444397,
        0.6592711210250854,
        0.685884416103363,
        0.6969159841537476,
        0.7330629825592041,
        0.7402054071426392,
        0.742564857006073,
        0.767773449420929,
        0.7688357830047607,
        0.7688357830047607,
        0.7691805958747864
      ],
      "expected": {
        "calibrated_mae": 0.137703
      }
    },
    {
      "context_key": "easy:triplet-p1:random:4000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48033809661865234,
        0.48033809661865234,
        0.48033809661865234,
        0.5214221477508545,
        0.5326480269432068,
        0.5478243827819824,
        0.5697588920593262,
        0.5902210474014282,
        0.614384114742279,
        0.6423031091690063,
        0.6652954816818237,
        0.6918200850486755,
        0.7027263045310974,
        0.7383797764778137,
        0.7455955147743225,
        0.7480336427688599,
        0.7723875045776367,
        0.773578405380249,
        0.773578405380249,
        0.7738566994667053
      ],
      "expected": {
        "calibrated_mae": 0.136954
      }
    },
    {
      "context_key": "easy:triplet-p1:random:4000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47846171259880066,
        0.47846171259880066,
        0.47846171259880066,
        0.5197615027427673,
        0.5309293270111084,
        0.5461019277572632,
        0.56795734167099,
        0.5884903073310852,
        0.6126788854598999,
        0.6408136487007141,
        0.6638899445533752,
        0.6906452178955078,
        0.7015339732170105,
        0.7374605536460876,
        0.7446683049201965,
        0.7470790147781372,
        0.7718262076377869,
        0.7729584276676178,
        0.7729584276676178,
        0.773201584815979
      ],
      "expected": {
        "calibrated_mae": 0.136681
      }
    },
    {
      "context_key": "easy:triplet-p1:random:4000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.473817636569341,
        0.473817636569341,
        0.473817636569341,
        0.5135303735733032,
        0.5244036912918091,
        0.5394734144210815,
        0.5609151124954224,
        0.5814313888549805,
        0.6055207848548889,
        0.6336349844932556,
        0.6567294597625732,
        0.6836135387420654,
        0.6948450207710266,
        0.7315861582756042,
        0.7388741374015808,
        0.7412143349647522,
        0.7667971849441528,
        0.7678673267364502,
        0.7678673267364502,
        0.7682146430015564
      ],
      "expected": {
        "calibrated_mae": 0.137242
      }
    },
    {
      "context_key": "easy:triplet-p1:random:10000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47635658582051593,
        0.47635658582051593,
        0.47635658582051593,
        0.5213162302970886,
        0.5336199998855591,
        0.5508859157562256,
        0.5749934911727905,
        0.5978848338127136,
        0.625062882900238,
        0.6564783453941345,
        0.6820791959762573,
        0.7106091976165771,
        0.7229284644126892,
        0.7600299119949341,
        0.7671095132827759,
        0.7698989510536194,
        0.7944585084915161,
        0.7956147789955139,
        0.7956147789955139,
        0.7960305213928223
      ],
      "expected": {
        "calibrated_mae": 0.126567
      }
    },
    {
      "context_key": "easy:triplet-p1:random:10000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4836871723333995,
        0.4836871723333995,
        0.4836871723333995,
        0.5285072922706604,
        0.541009783744812,
        0.5579807162284851,
        0.5821135640144348,
        0.6046226024627686,
        0.6315459609031677,
        0.6622453927993774,
        0.6875652074813843,
        0.7153982520103455,
        0.7273035049438477,
        0.7634000778198242,
        0.7704495191574097,
        0.7732822299003601,
        0.7968621253967285,
        0.7981575727462769,
        0.7981575727462769,
        0.7984946370124817
      ],
      "expected": {
        "calibrated_mae": 0.127744
      }
    },
    {
      "context_key": "easy:triplet-p1:random:10000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4787895282109578,
        0.4787895282109578,
        0.4787895282109578,
        0.5246397852897644,
        0.53722083568573,
        0.554455041885376,
        0.5789417028427124,
        0.6018921732902527,
        0.6292184591293335,
        0.6606008410453796,
        0.6862700581550598,
        0.7146826982498169,
        0.7267093062400818,
        0.7632548213005066,
        0.7703609466552734,
        0.7731819748878479,
        0.7971335649490356,
        0.7983778417110443,
        0.7983778417110443,
        0.7986679673194885
      ],
      "expected": {
        "calibrated_mae": 0.126224
      }
    },
    {
      "context_key": "easy:triplet-p1:random:10000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47388700644175213,
        0.47388700644175213,
        0.47388700644175213,
        0.5180743336677551,
        0.5303745865821838,
        0.5474805235862732,
        0.5715189576148987,
        0.5944433212280273,
        0.6216457486152649,
        0.6529893279075623,
        0.6786978244781494,
        0.7073655724525452,
        0.7197578549385071,
        0.7573959231376648,
        0.764643132686615,
        0.7674532532691956,
        0.7923800349235535,
        0.7935751676559448,
        0.7935751676559448,
        0.7940207719802856
      ],
      "expected": {
        "calibrated_mae": 0.126635
      }
    },
    {
      "context_key": "easy:triplet-p1:random:25000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4608713189760844,
        0.4608713189760844,
        0.4608713189760844,
        0.5070610642433167,
        0.5201185941696167,
        0.5386743545532227,
        0.5644241571426392,
        0.5900219082832336,
        0.6201054453849792,
        0.6559354066848755,
        0.685584306716919,
        0.7175581455230713,
        0.7321884036064148,
        0.7744914889335632,
        0.7825813293457031,
        0.7856545448303223,
        0.8127544522285461,
        0.8138871490955353,
        0.8138871490955353,
        0.8141786456108093
      ],
      "expected": {
        "calibrated_mae": 0.114184
      }
    },
    {
      "context_key": "easy:triplet-p1:random:25000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47022613883018494,
        0.47022613883018494,
        0.47022613883018494,
        0.5167110562324524,
        0.530099630355835,
        0.548425018787384,
        0.5741990804672241,
        0.5993701815605164,
        0.6291188597679138,
        0.664020836353302,
        0.6931664943695068,
        0.7241238355636597,
        0.7381770014762878,
        0.7787699103355408,
        0.7866252660751343,
        0.7896856665611267,
        0.8153698444366455,
        0.8166110217571259,
        0.8166110217571259,
        0.8168206810951233
      ],
      "expected": {
        "calibrated_mae": 0.115899
      }
    },
    {
      "context_key": "easy:triplet-p1:random:25000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4645572006702423,
        0.4645572006702423,
        0.4645572006702423,
        0.511716902256012,
        0.525158166885376,
        0.5437677502632141,
        0.569918692111969,
        0.5956523418426514,
        0.6260112524032593,
        0.6618701219558716,
        0.6916368007659912,
        0.7234262824058533,
        0.7377106547355652,
        0.779129147529602,
        0.7871537804603577,
        0.7902342677116394,
        0.8164612054824829,
        0.8176389932632446,
        0.8176389932632446,
        0.8177977800369263
      ],
      "expected": {
        "calibrated_mae": 0.113728
      }
    },
    {
      "context_key": "easy:triplet-p1:random:25000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4604681134223938,
        0.4604681134223938,
        0.4604681134223938,
        0.5061014890670776,
        0.5192759037017822,
        0.537785530090332,
        0.563505232334137,
        0.5892074704170227,
        0.6193041801452637,
        0.6549764275550842,
        0.6845415234565735,
        0.7163122296333313,
        0.7309016585350037,
        0.7731764912605286,
        0.7812894582748413,
        0.784243643283844,
        0.8114494681358337,
        0.8125864267349243,
        0.8125864267349243,
        0.8128867745399475
      ],
      "expected": {
        "calibrated_mae": 0.114549
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4200323224067688,
        0.4200323224067688,
        0.4200323224067688,
        0.49313342571258545,
        0.5136812925338745,
        0.5441400408744812,
        0.58744215965271,
        0.6267033815383911,
        0.6753209829330444,
        0.7293685674667358,
        0.7705822587013245,
        0.8113479614257812,
        0.8272753953933716,
        0.8654052019119263,
        0.8727224469184875,
        0.8757722973823547,
        0.8940788507461548,
        0.8956388235092163,
        0.8956388235092163,
        0.8965097665786743
      ],
      "expected": {
        "calibrated_mae": 0.066379
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.43045740326245624,
        0.43045740326245624,
        0.43045740326245624,
        0.5026715993881226,
        0.523219883441925,
        0.5528856515884399,
        0.596427321434021,
        0.6356350779533386,
        0.6842408180236816,
        0.7368311882019043,
        0.7768009901046753,
        0.8151935338973999,
        0.8300958275794983,
        0.8668559193611145,
        0.8740066885948181,
        0.8771273493766785,
        0.8945918083190918,
        0.8962827026844025,
        0.8962827026844025,
        0.8970818519592285
      ],
      "expected": {
        "calibrated_mae": 0.070081
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4203015963236491,
        0.4203015963236491,
        0.4203015963236491,
        0.49376916885375977,
        0.5145511627197266,
        0.5446169972419739,
        0.5886436104774475,
        0.6284552216529846,
        0.6778973937034607,
        0.7319765686988831,
        0.7729155421257019,
        0.8125637769699097,
        0.8278294205665588,
        0.8649937510490417,
        0.8723526000976562,
        0.8754460215568542,
        0.893384575843811,
        0.8950587213039398,
        0.8950587213039398,
        0.8957864046096802
      ],
      "expected": {
        "calibrated_mae": 0.066904
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4200368622938792,
        0.4200368622938792,
        0.4200368622938792,
        0.49282678961753845,
        0.5133786797523499,
        0.5438292026519775,
        0.5878027677536011,
        0.6279046535491943,
        0.6773624420166016,
        0.7317254543304443,
        0.7727693915367126,
        0.813059389591217,
        0.8286474943161011,
        0.8663748502731323,
        0.8736855387687683,
        0.8768234848976135,
        0.8947710990905762,
        0.8964171409606934,
        0.8964463472366333,
        0.8973780274391174
      ],
      "expected": {
        "calibrated_mae": 0.066062
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:1500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46247700850168866,
        0.46247700850168866,
        0.46247700850168866,
        0.5157862901687622,
        0.529915988445282,
        0.5498170256614685,
        0.5782133340835571,
        0.6039780378341675,
        0.6353846788406372,
        0.6707553267478943,
        0.6991603374481201,
        0.7310580611228943,
        0.7435479760169983,
        0.7822999358177185,
        0.7901537418365479,
        0.793472409248352,
        0.8176062107086182,
        0.819422036409378,
        0.819422036409378,
        0.8203116059303284
      ],
      "expected": {
        "calibrated_mae": 0.113134
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:1500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4671977460384369,
        0.4671977460384369,
        0.4671977460384369,
        0.5209707617759705,
        0.5354888439178467,
        0.5554276704788208,
        0.5845703482627869,
        0.6105099320411682,
        0.6422064304351807,
        0.6772436499595642,
        0.705488383769989,
        0.736611008644104,
        0.7486922144889832,
        0.786534309387207,
        0.7943904399871826,
        0.797775387763977,
        0.8208691477775574,
        0.8228152096271515,
        0.8228152096271515,
        0.8236253261566162
      ],
      "expected": {
        "calibrated_mae": 0.113163
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:1500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46147462725639343,
        0.46147462725639343,
        0.46147462725639343,
        0.5165814161300659,
        0.5311853289604187,
        0.5513110756874084,
        0.5807101726531982,
        0.6069185733795166,
        0.6389039158821106,
        0.6744417548179626,
        0.7028706669807434,
        0.734474778175354,
        0.7465777397155762,
        0.7845926284790039,
        0.7925253510475159,
        0.7959123253822327,
        0.8194103837013245,
        0.8213568031787872,
        0.8213568031787872,
        0.8221419453620911
      ],
      "expected": {
        "calibrated_mae": 0.112186
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:1500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4588923752307892,
        0.4588923752307892,
        0.4588923752307892,
        0.5123358368873596,
        0.5266201496124268,
        0.5467110276222229,
        0.5757529139518738,
        0.6021050810813904,
        0.6341316103935242,
        0.6699798107147217,
        0.6987332105636597,
        0.7309658527374268,
        0.7435476779937744,
        0.7827280759811401,
        0.7907558679580688,
        0.7942120432853699,
        0.8183573484420776,
        0.8202711641788483,
        0.8202711641788483,
        0.8212555646896362
      ],
      "expected": {
        "calibrated_mae": 0.111631
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:4000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.476181427637736,
        0.476181427637736,
        0.476181427637736,
        0.5183798670768738,
        0.529891312122345,
        0.546302318572998,
        0.569873571395874,
        0.5920485258102417,
        0.6182947754859924,
        0.6490716338157654,
        0.6741737723350525,
        0.7032972574234009,
        0.7151563167572021,
        0.7533776164054871,
        0.7609540224075317,
        0.7639502882957458,
        0.7892435789108276,
        0.7906114459037781,
        0.7906114459037781,
        0.7912495732307434
      ],
      "expected": {
        "calibrated_mae": 0.12855
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:4000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4792340099811554,
        0.4792340099811554,
        0.4792340099811554,
        0.5222935080528259,
        0.5342168807983398,
        0.5507715940475464,
        0.5750513672828674,
        0.5974817276000977,
        0.6242291927337646,
        0.655094563961029,
        0.680432140827179,
        0.7094441652297974,
        0.7211529612541199,
        0.7588707208633423,
        0.7665035128593445,
        0.7695652842521667,
        0.7939690947532654,
        0.7954665124416351,
        0.7954665124416351,
        0.7960341572761536
      ],
      "expected": {
        "calibrated_mae": 0.127455
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:4000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4759897192319234,
        0.4759897192319234,
        0.4759897192319234,
        0.5198203325271606,
        0.5317943692207336,
        0.5484979152679443,
        0.5729080438613892,
        0.5955291986465454,
        0.6224648356437683,
        0.6536712646484375,
        0.6792098879814148,
        0.708574116230011,
        0.7202938199043274,
        0.7583271861076355,
        0.7659905552864075,
        0.769059419631958,
        0.7938332557678223,
        0.7952792942523956,
        0.7952792942523956,
        0.7958325743675232
      ],
      "expected": {
        "calibrated_mae": 0.126649
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:4000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4729006290435791,
        0.4729006290435791,
        0.4729006290435791,
        0.5149391293525696,
        0.5265140533447266,
        0.5429808497428894,
        0.5667810440063477,
        0.5892676711082458,
        0.6159620881080627,
        0.6470707058906555,
        0.6726351380348206,
        0.7022254467010498,
        0.7143535614013672,
        0.7534106969833374,
        0.7611792683601379,
        0.7642368078231812,
        0.7898867130279541,
        0.7913045287132263,
        0.7913045287132263,
        0.7919813394546509
      ],
      "expected": {
        "calibrated_mae": 0.127246
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:10000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4747820595900218,
        0.4747820595900218,
        0.4747820595900218,
        0.5210914015769958,
        0.5340802073478699,
        0.5528308153152466,
        0.579429566860199,
        0.604608952999115,
        0.6349315643310547,
        0.6701030135154724,
        0.6988787055015564,
        0.73050457239151,
        0.7439651489257812,
        0.7830565571784973,
        0.7903750538825989,
        0.7937132120132446,
        0.8176801800727844,
        0.8190116286277771,
        0.8190116286277771,
        0.8196877241134644
      ],
      "expected": {
        "calibrated_mae": 0.115734
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:10000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48172391454378766,
        0.48172391454378766,
        0.48172391454378766,
        0.5281972289085388,
        0.5414213538169861,
        0.5598669052124023,
        0.5865415930747986,
        0.6113684773445129,
        0.6414639949798584,
        0.6758729815483093,
        0.7042413949966431,
        0.7349621653556824,
        0.7479259371757507,
        0.7858966588973999,
        0.7931617498397827,
        0.7965246438980103,
        0.819606602191925,
        0.8210986852645874,
        0.8210986852645874,
        0.821693480014801
      ],
      "expected": {
        "calibrated_mae": 0.117065
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:10000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4746331771214803,
        0.4746331771214803,
        0.4746331771214803,
        0.522710919380188,
        0.5361821055412292,
        0.5551701784133911,
        0.5826291441917419,
        0.608205258846283,
        0.6391128301620483,
        0.6745873093605042,
        0.7035723924636841,
        0.7351292371749878,
        0.7482626438140869,
        0.7866734862327576,
        0.7940201163291931,
        0.7973981499671936,
        0.8206878304481506,
        0.8221248388290405,
        0.8221248388290405,
        0.8226950168609619
      ],
      "expected": {
        "calibrated_mae": 0.114499
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:10000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47131126125653583,
        0.47131126125653583,
        0.47131126125653583,
        0.5176882147789001,
        0.5307798981666565,
        0.5495358109474182,
        0.5763471126556396,
        0.6017785668373108,
        0.6323816180229187,
        0.6676971912384033,
        0.6967098712921143,
        0.7285851836204529,
        0.7421600222587585,
        0.7818979620933533,
        0.7894089221954346,
        0.7928484678268433,
        0.8171507120132446,
        0.8185780048370361,
        0.8185780048370361,
        0.8193227648735046
      ],
      "expected": {
        "calibrated_mae": 0.114943
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:25000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46025097370147705,
        0.46025097370147705,
        0.46025097370147705,
        0.5084276795387268,
        0.5221059322357178,
        0.541978120803833,
        0.5699295401573181,
        0.5974624156951904,
        0.630240797996521,
        0.6692980527877808,
        0.7017287015914917,
        0.736354649066925,
        0.752031683921814,
        0.7963095307350159,
        0.8046149611473083,
        0.8082324862480164,
        0.834672749042511,
        0.8359682857990265,
        0.8359682857990265,
        0.8365415930747986
      ],
      "expected": {
        "calibrated_mae": 0.104427
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:25000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4690297146638234,
        0.4690297146638234,
        0.4690297146638234,
        0.5177924633026123,
        0.5318553447723389,
        0.5514917969703674,
        0.5794854164123535,
        0.6065877676010132,
        0.639008104801178,
        0.6770416498184204,
        0.7088577747344971,
        0.7423317432403564,
        0.7573908567428589,
        0.7998566627502441,
        0.8078840374946594,
        0.8114507794380188,
        0.8365315794944763,
        0.8379264771938324,
        0.8379264771938324,
        0.8384024500846863
      ],
      "expected": {
        "calibrated_mae": 0.106353
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:25000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4616883297761281,
        0.4616883297761281,
        0.4616883297761281,
        0.5115883946418762,
        0.52583247423172,
        0.545981764793396,
        0.5746845006942749,
        0.6026077270507812,
        0.6359789371490479,
        0.6753000020980835,
        0.707974910736084,
        0.7424654960632324,
        0.7578042149543762,
        0.8011071085929871,
        0.8093302845954895,
        0.8129522800445557,
        0.8384472727775574,
        0.8397729396820068,
        0.8397729396820068,
        0.8402262330055237
      ],
      "expected": {
        "calibrated_mae": 0.103297
      }
    },
    {
      "context_key": "easy:triplet-p1:clear-greedy:25000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4591520329316457,
        0.4591520329316457,
        0.4591520329316457,
        0.507472574710846,
        0.5213907361030579,
        0.5413946509361267,
        0.5695663690567017,
        0.5974376201629639,
        0.630463719367981,
        0.6695690751075745,
        0.702063798904419,
        0.7365833520889282,
        0.7522922158241272,
        0.7966077923774719,
        0.8049417734146118,
        0.8084872364997864,
        0.8349563479423523,
        0.836275041103363,
        0.836275041103363,
        0.8368812203407288
      ],
      "expected": {
        "calibrated_mae": 0.10398
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42567284901936847,
        0.42567284901936847,
        0.42567284901936847,
        0.49726635217666626,
        0.5172930955886841,
        0.5468188524246216,
        0.5888780355453491,
        0.627519428730011,
        0.6753798723220825,
        0.727903425693512,
        0.7681072950363159,
        0.8080295324325562,
        0.8239678144454956,
        0.862644612789154,
        0.8701815009117126,
        0.873236358165741,
        0.8921558856964111,
        0.8936969935894012,
        0.8936969935894012,
        0.894490122795105
      ],
      "expected": {
        "calibrated_mae": 0.069027
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4366604785124461,
        0.4366604785124461,
        0.4366604785124461,
        0.5076916217803955,
        0.5278416275978088,
        0.5566911697387695,
        0.598956823348999,
        0.6373006701469421,
        0.6848114132881165,
        0.7357308864593506,
        0.7747477293014526,
        0.8124595880508423,
        0.8273783326148987,
        0.8645290732383728,
        0.8718536496162415,
        0.8749698400497437,
        0.892880916595459,
        0.8945543766021729,
        0.8945543766021729,
        0.8952792286872864
      ],
      "expected": {
        "calibrated_mae": 0.072923
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4276171922683716,
        0.4276171922683716,
        0.4276171922683716,
        0.49944499135017395,
        0.5196540355682373,
        0.5486950278282166,
        0.5912242531776428,
        0.6300181150436401,
        0.6781288385391235,
        0.7302082180976868,
        0.7699740529060364,
        0.8087683320045471,
        0.8240768313407898,
        0.8618400692939758,
        0.869409441947937,
        0.8724940419197083,
        0.8910161852836609,
        0.8926583826541901,
        0.8926583826541901,
        0.8932891488075256
      ],
      "expected": {
        "calibrated_mae": 0.070335
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4267389973004659,
        0.4267389973004659,
        0.4267389973004659,
        0.4977295398712158,
        0.5177151560783386,
        0.5470812320709229,
        0.5895562767982483,
        0.6287639737129211,
        0.677123486995697,
        0.7297260165214539,
        0.7697316408157349,
        0.8092547059059143,
        0.8249422311782837,
        0.8634338974952698,
        0.8710057139396667,
        0.8741424083709717,
        0.8927749395370483,
        0.8944070637226105,
        0.8944070637226105,
        0.8952652215957642
      ],
      "expected": {
        "calibrated_mae": 0.069061
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:1500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46648915608723956,
        0.46648915608723956,
        0.46648915608723956,
        0.5187027454376221,
        0.5325767993927002,
        0.5520438551902771,
        0.5798130631446838,
        0.6051837205886841,
        0.6359720826148987,
        0.6703081727027893,
        0.6979032158851624,
        0.7290006875991821,
        0.7413336634635925,
        0.7797417044639587,
        0.7875409126281738,
        0.790722131729126,
        0.814980149269104,
        0.8166989684104919,
        0.8166989684104919,
        0.8174741268157959
      ],
      "expected": {
        "calibrated_mae": 0.115536
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:1500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4714532792568207,
        0.4714532792568207,
        0.4714532792568207,
        0.5242255926132202,
        0.5385021567344666,
        0.557988166809082,
        0.5864346623420715,
        0.6118981242179871,
        0.6428916454315186,
        0.6768958568572998,
        0.7043887972831726,
        0.7347869277000427,
        0.7467243075370789,
        0.7841756343841553,
        0.7919667363166809,
        0.7952180504798889,
        0.8183587789535522,
        0.8202134370803833,
        0.8202134370803833,
        0.8209162950515747
      ],
      "expected": {
        "calibrated_mae": 0.11559
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:1500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46656590700149536,
        0.46656590700149536,
        0.46656590700149536,
        0.5201974511146545,
        0.5344637632369995,
        0.554015576839447,
        0.5825466513633728,
        0.6081583499908447,
        0.6392788290977478,
        0.673629641532898,
        0.7012217044830322,
        0.7320461273193359,
        0.7440236806869507,
        0.7817568778991699,
        0.7896292805671692,
        0.7928696274757385,
        0.8164779543876648,
        0.818308562040329,
        0.818308562040329,
        0.8189642429351807
      ],
      "expected": {
        "calibrated_mae": 0.115024
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:1500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4633818566799164,
        0.4633818566799164,
        0.4633818566799164,
        0.5153912901878357,
        0.5293641686439514,
        0.5489010214805603,
        0.57712721824646,
        0.6029497385025024,
        0.6342054605484009,
        0.6689372062683105,
        0.6968910098075867,
        0.7283569574356079,
        0.7408323884010315,
        0.779809832572937,
        0.7878120541572571,
        0.791111946105957,
        0.8154820799827576,
        0.8172842562198639,
        0.8172842562198639,
        0.8181400299072266
      ],
      "expected": {
        "calibrated_mae": 0.114275
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:4000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4793781340122223,
        0.4793781340122223,
        0.4793781340122223,
        0.5208045244216919,
        0.5321243405342102,
        0.5481755137443542,
        0.5711239576339722,
        0.5929351449012756,
        0.6186112761497498,
        0.6485409140586853,
        0.6729422807693481,
        0.7013087272644043,
        0.712988018989563,
        0.7506886124610901,
        0.7581470012664795,
        0.7609366178512573,
        0.7862800359725952,
        0.7875193953514099,
        0.7875193953514099,
        0.788029670715332
      ],
      "expected": {
        "calibrated_mae": 0.130818
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:4000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48273008068402606,
        0.48273008068402606,
        0.48273008068402606,
        0.5250388979911804,
        0.5367811918258667,
        0.5529633164405823,
        0.5765840411186218,
        0.5986117720603943,
        0.6247462034225464,
        0.654758632183075,
        0.6794208884239197,
        0.7077076435089111,
        0.7192515730857849,
        0.7564340829849243,
        0.763953685760498,
        0.7668235301971436,
        0.7912487983703613,
        0.7926283478736877,
        0.7926283478736877,
        0.7930757999420166
      ],
      "expected": {
        "calibrated_mae": 0.129717
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:4000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48024290800094604,
        0.48024290800094604,
        0.48024290800094604,
        0.5230295658111572,
        0.5347599983215332,
        0.5510001182556152,
        0.5746119618415833,
        0.5967451930046082,
        0.6229566335678101,
        0.6532195806503296,
        0.6780211925506592,
        0.7066060304641724,
        0.7181517481803894,
        0.7556637525558472,
        0.7632026672363281,
        0.7660634517669678,
        0.7908877730369568,
        0.7921987473964691,
        0.7921987473964691,
        0.7926162481307983
      ],
      "expected": {
        "calibrated_mae": 0.129218
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:4000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4763867159684499,
        0.4763867159684499,
        0.4763867159684499,
        0.5174628496170044,
        0.5288244485855103,
        0.5448727607727051,
        0.5679497122764587,
        0.5900056958198547,
        0.6160466074943542,
        0.6462554931640625,
        0.6710929870605469,
        0.6999034881591797,
        0.7118604183197021,
        0.7504225969314575,
        0.7580850124359131,
        0.7609120011329651,
        0.7866969704627991,
        0.787979245185852,
        0.787979245185852,
        0.7885177731513977
      ],
      "expected": {
        "calibrated_mae": 0.129699
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:10000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47859230637550354,
        0.47859230637550354,
        0.47859230637550354,
        0.5241143107414246,
        0.5368812680244446,
        0.5551416873931885,
        0.580929160118103,
        0.605522632598877,
        0.6350181698799133,
        0.6689575910568237,
        0.6967633962631226,
        0.7274407148361206,
        0.7406485676765442,
        0.7793333530426025,
        0.7866158485412598,
        0.7898059487342834,
        0.8140629529953003,
        0.8153189420700073,
        0.8153189420700073,
        0.8158795833587646
      ],
      "expected": {
        "calibrated_mae": 0.11863
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:10000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4856758217016856,
        0.4856758217016856,
        0.4856758217016856,
        0.531358540058136,
        0.5443790555000305,
        0.5623541474342346,
        0.5882261991500854,
        0.6124588847160339,
        0.6417148113250732,
        0.674930214881897,
        0.7023866176605225,
        0.732231855392456,
        0.7449623942375183,
        0.7825152277946472,
        0.7897406220436096,
        0.792963445186615,
        0.8162428736686707,
        0.8176561594009399,
        0.8176561594009399,
        0.8181398510932922
      ],
      "expected": {
        "calibrated_mae": 0.119872
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:10000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4795728623867035,
        0.4795728623867035,
        0.4795728623867035,
        0.526580810546875,
        0.5397641658782959,
        0.5581475496292114,
        0.5845919251441956,
        0.6094228029251099,
        0.6392909288406372,
        0.6733795404434204,
        0.7013338804244995,
        0.7319096326828003,
        0.7447980046272278,
        0.7828446626663208,
        0.7901549935340881,
        0.7933853268623352,
        0.8169697523117065,
        0.8183221220970154,
        0.8183221220970154,
        0.8187651634216309
      ],
      "expected": {
        "calibrated_mae": 0.117784
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:10000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4753820200761159,
        0.4753820200761159,
        0.4753820200761159,
        0.5207391977310181,
        0.5335867404937744,
        0.5517920851707458,
        0.5776900053024292,
        0.6024649143218994,
        0.632150411605835,
        0.6661849021911621,
        0.6942131519317627,
        0.725143551826477,
        0.7384814023971558,
        0.7778801321983337,
        0.7853726148605347,
        0.7886438965797424,
        0.8133149147033691,
        0.8146539926528931,
        0.8146539926528931,
        0.8152724504470825
      ],
      "expected": {
        "calibrated_mae": 0.118005
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:25000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46199750900268555,
        0.46199750900268555,
        0.46199750900268555,
        0.5090847611427307,
        0.5225591659545898,
        0.5420094132423401,
        0.5692307949066162,
        0.5963834524154663,
        0.6285533905029297,
        0.6666381359100342,
        0.6983322501182556,
        0.7322347164154053,
        0.747779130935669,
        0.7918553352355957,
        0.8001735210418701,
        0.8036216497421265,
        0.8305730223655701,
        0.8317826688289642,
        0.8317826688289642,
        0.8322159051895142
      ],
      "expected": {
        "calibrated_mae": 0.106809
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:25000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4713171025117238,
        0.4713171025117238,
        0.4713171025117238,
        0.5190853476524353,
        0.532978892326355,
        0.5522288680076599,
        0.5795406103134155,
        0.6062710881233215,
        0.6380953788757324,
        0.6751978993415833,
        0.7063021659851074,
        0.7390550971031189,
        0.7539634108543396,
        0.7961392402648926,
        0.8041685819625854,
        0.8075911998748779,
        0.8330467939376831,
        0.8343657851219177,
        0.8343657851219177,
        0.8347126245498657
      ],
      "expected": {
        "calibrated_mae": 0.10863
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:25000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4644953707853953,
        0.4644953707853953,
        0.4644953707853953,
        0.5131638646125793,
        0.5271766185760498,
        0.5468443632125854,
        0.5747182965278625,
        0.6021760106086731,
        0.6348168253898621,
        0.6730799078941345,
        0.7049567103385925,
        0.7386623024940491,
        0.7538362145423889,
        0.7968709468841553,
        0.8050921559333801,
        0.8085513710975647,
        0.8344994783401489,
        0.8357385396957397,
        0.8357385396957397,
        0.8360446095466614
      ],
      "expected": {
        "calibrated_mae": 0.105933
      }
    },
    {
      "context_key": "easy:triplet-p1:survival:25000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46108267704645794,
        0.46108267704645794,
        0.46108267704645794,
        0.508145809173584,
        0.5218479037284851,
        0.5413888692855835,
        0.5687851905822754,
        0.5962353944778442,
        0.6286093592643738,
        0.666729211807251,
        0.6984738707542419,
        0.7322658896446228,
        0.7478376030921936,
        0.7919765114784241,
        0.800334632396698,
        0.8037036657333374,
        0.8307265043258667,
        0.8319565653800964,
        0.8319565653800964,
        0.8324165344238281
      ],
      "expected": {
        "calibrated_mae": 0.106462
      }
    },
    {
      "context_key": "easy:budget-p2:random:500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42436251044273376,
        0.42436251044273376,
        0.42436251044273376,
        0.4974687099456787,
        0.5177406072616577,
        0.5479239225387573,
        0.5913693308830261,
        0.6288124918937683,
        0.6722825765609741,
        0.7177571058273315,
        0.7521501183509827,
        0.785706639289856,
        0.7994852662086487,
        0.837102472782135,
        0.8450990915298462,
        0.8478001952171326,
        0.869182825088501,
        0.870825469493866,
        0.870825469493866,
        0.8715531229972839
      ],
      "expected": {
        "calibrated_mae": 0.080528
      }
    },
    {
      "context_key": "easy:budget-p2:random:500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4345812996228536,
        0.4345812996228536,
        0.4345812996228536,
        0.5085628628730774,
        0.528836727142334,
        0.5580911636352539,
        0.6004919409751892,
        0.6364665627479553,
        0.6787261366844177,
        0.7226678729057312,
        0.7567576169967651,
        0.7897104620933533,
        0.8030880689620972,
        0.8402631878852844,
        0.8482090830802917,
        0.8510793447494507,
        0.8714102506637573,
        0.8732219636440277,
        0.8732219636440277,
        0.8738918900489807
      ],
      "expected": {
        "calibrated_mae": 0.083038
      }
    },
    {
      "context_key": "easy:budget-p2:random:500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4243237376213074,
        0.4243237376213074,
        0.4243237376213074,
        0.499329149723053,
        0.5200040340423584,
        0.5498822927474976,
        0.5932251214981079,
        0.6300153732299805,
        0.6728245615959167,
        0.7174437046051025,
        0.7516921758651733,
        0.7850131988525391,
        0.7985391020774841,
        0.8360264897346497,
        0.8441684246063232,
        0.846991777420044,
        0.8681680560112,
        0.8699723780155182,
        0.8699723780155182,
        0.8705505728721619
      ],
      "expected": {
        "calibrated_mae": 0.081453
      }
    },
    {
      "context_key": "easy:budget-p2:random:500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42665478587150574,
        0.42665478587150574,
        0.42665478587150574,
        0.49857819080352783,
        0.5184614062309265,
        0.5478557348251343,
        0.5904811024665833,
        0.6274864673614502,
        0.6706894040107727,
        0.7161287069320679,
        0.750654935836792,
        0.7845595479011536,
        0.7983803749084473,
        0.8364856839179993,
        0.8446049690246582,
        0.8474197387695312,
        0.8687363862991333,
        0.8704618811607361,
        0.8704618811607361,
        0.871264636516571
      ],
      "expected": {
        "calibrated_mae": 0.081186
      }
    },
    {
      "context_key": "easy:budget-p2:random:1500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4594939053058624,
        0.4594939053058624,
        0.4594939053058624,
        0.5115262866020203,
        0.5249521732330322,
        0.5438128709793091,
        0.5703702569007874,
        0.5937553644180298,
        0.6213844418525696,
        0.6515137553215027,
        0.6760143041610718,
        0.703140914440155,
        0.7140664458274841,
        0.7502968907356262,
        0.757857084274292,
        0.760328471660614,
        0.7852368354797363,
        0.7867477238178253,
        0.7867477238178253,
        0.7872174382209778
      ],
      "expected": {
        "calibrated_mae": 0.126724
      }
    },
    {
      "context_key": "easy:budget-p2:random:1500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4640858868757884,
        0.4640858868757884,
        0.4640858868757884,
        0.5170514583587646,
        0.5307468771934509,
        0.5494756698608398,
        0.5762321949005127,
        0.5993455648422241,
        0.6269298791885376,
        0.6567321419715881,
        0.6813754439353943,
        0.7084094285964966,
        0.7191920876502991,
        0.7551566958427429,
        0.7628669142723083,
        0.765505313873291,
        0.7895593047142029,
        0.7912512123584747,
        0.7912512123584747,
        0.7916832566261292
      ],
      "expected": {
        "calibrated_mae": 0.126421
      }
    },
    {
      "context_key": "easy:budget-p2:random:1500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4583102762699127,
        0.4583102762699127,
        0.4583102762699127,
        0.5123265385627747,
        0.526138961315155,
        0.5450325012207031,
        0.5720126628875732,
        0.5953400731086731,
        0.6229760050773621,
        0.6529436111450195,
        0.6774874329566956,
        0.7046207785606384,
        0.7153487801551819,
        0.7513728141784668,
        0.7590962648391724,
        0.7616981267929077,
        0.786283016204834,
        0.7879557013511658,
        0.7879557013511658,
        0.7883322238922119
      ],
      "expected": {
        "calibrated_mae": 0.126251
      }
    },
    {
      "context_key": "easy:budget-p2:random:1500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4577520191669464,
        0.4577520191669464,
        0.4577520191669464,
        0.5088534355163574,
        0.522156834602356,
        0.5407784581184387,
        0.5672709941864014,
        0.590729296207428,
        0.6185539364814758,
        0.6489821076393127,
        0.6738294959068298,
        0.7014336585998535,
        0.7125580310821533,
        0.7494320869445801,
        0.7571896314620972,
        0.7597601413726807,
        0.7848569750785828,
        0.7864125669002533,
        0.7864125669002533,
        0.7869408130645752
      ],
      "expected": {
        "calibrated_mae": 0.126157
      }
    },
    {
      "context_key": "easy:budget-p2:random:4000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47233633200327557,
        0.47233633200327557,
        0.47233633200327557,
        0.5136366486549377,
        0.5244836211204529,
        0.5398800373077393,
        0.5617012977600098,
        0.581900417804718,
        0.6054317355155945,
        0.6324476003646851,
        0.6546989679336548,
        0.6800591349601746,
        0.6905522346496582,
        0.7256859540939331,
        0.7326988577842712,
        0.7348284125328064,
        0.7597877383232117,
        0.7608380913734436,
        0.7608380913734436,
        0.7610626220703125
      ],
      "expected": {
        "calibrated_mae": 0.139995
      }
    },
    {
      "context_key": "easy:budget-p2:random:4000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47492984930674237,
        0.47492984930674237,
        0.47492984930674237,
        0.5172385573387146,
        0.5284227132797241,
        0.5438888669013977,
        0.5661577582359314,
        0.5863974690437317,
        0.610222339630127,
        0.6372438669204712,
        0.6598270535469055,
        0.6853905916213989,
        0.6958798766136169,
        0.7310235500335693,
        0.7382318377494812,
        0.7405177354812622,
        0.7649074792861938,
        0.7661272585391998,
        0.7661272585391998,
        0.7663140296936035
      ],
      "expected": {
        "calibrated_mae": 0.138744
      }
    },
    {
      "context_key": "easy:budget-p2:random:4000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4719695448875427,
        0.4719695448875427,
        0.4719695448875427,
        0.5144820809364319,
        0.5256454348564148,
        0.5411092042922974,
        0.5633522272109985,
        0.5837008357048035,
        0.6075953245162964,
        0.6348491311073303,
        0.6575080156326294,
        0.6832863092422485,
        0.6937350630760193,
        0.7290684580802917,
        0.7362571358680725,
        0.7384995818138123,
        0.7632629871368408,
        0.7644252777099609,
        0.7644252777099609,
        0.7645761370658875
      ],
      "expected": {
        "calibrated_mae": 0.138563
      }
    },
    {
      "context_key": "easy:budget-p2:random:4000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4708982507387797,
        0.4708982507387797,
        0.4708982507387797,
        0.5111840963363647,
        0.5219082236289978,
        0.5370893478393555,
        0.5587059855461121,
        0.5789088010787964,
        0.6026048064231873,
        0.6297982931137085,
        0.6523999571800232,
        0.678198516368866,
        0.6889538764953613,
        0.7248457074165344,
        0.73201984167099,
        0.7341782450675964,
        0.7595512866973877,
        0.7606169581413269,
        0.7606169581413269,
        0.7608478665351868
      ],
      "expected": {
        "calibrated_mae": 0.139521
      }
    },
    {
      "context_key": "easy:budget-p2:random:10000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4713949958483378,
        0.4713949958483378,
        0.4713949958483378,
        0.517014741897583,
        0.5293280482292175,
        0.5470781326293945,
        0.5721264481544495,
        0.5953441262245178,
        0.6227981448173523,
        0.65388023853302,
        0.6793532967567444,
        0.706935465335846,
        0.7187725901603699,
        0.7550538778305054,
        0.7620623707771301,
        0.764615535736084,
        0.789030134677887,
        0.7901907861232758,
        0.7901907861232758,
        0.7905350923538208
      ],
      "expected": {
        "calibrated_mae": 0.12733
      }
    },
    {
      "context_key": "easy:budget-p2:random:10000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47735604643821716,
        0.47735604643821716,
        0.47735604643821716,
        0.5232828259468079,
        0.5357707142829895,
        0.5532222390174866,
        0.5781852602958679,
        0.6009388566017151,
        0.6281003952026367,
        0.6585446000099182,
        0.6839025616645813,
        0.7111276388168335,
        0.7227156758308411,
        0.7585116624832153,
        0.7655996084213257,
        0.7682855725288391,
        0.7919753193855286,
        0.7933220863342285,
        0.7933220863342285,
        0.793617844581604
      ],
      "expected": {
        "calibrated_mae": 0.128
      }
    },
    {
      "context_key": "easy:budget-p2:random:10000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.470711608727773,
        0.470711608727773,
        0.470711608727773,
        0.5177839994430542,
        0.5304573774337769,
        0.5482820272445679,
        0.5738115310668945,
        0.59715336561203,
        0.624849259853363,
        0.6560336351394653,
        0.6817585229873657,
        0.7095116972923279,
        0.7211918234825134,
        0.7573249340057373,
        0.7644509673118591,
        0.7671138644218445,
        0.7911633253097534,
        0.7924537658691406,
        0.7924537658691406,
        0.7927002906799316
      ],
      "expected": {
        "calibrated_mae": 0.126384
      }
    },
    {
      "context_key": "easy:budget-p2:random:10000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46992191672325134,
        0.46992191672325134,
        0.46992191672325134,
        0.514650285243988,
        0.5268327593803406,
        0.5442526340484619,
        0.5689334273338318,
        0.5919656753540039,
        0.6193075776100159,
        0.6503086686134338,
        0.6759277582168579,
        0.7038492560386658,
        0.7158519625663757,
        0.752921998500824,
        0.7601319551467896,
        0.7627677917480469,
        0.7876126766204834,
        0.788825511932373,
        0.788825511932373,
        0.7892090082168579
      ],
      "expected": {
        "calibrated_mae": 0.127442
      }
    },
    {
      "context_key": "easy:budget-p2:random:25000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.45969220995903015,
        0.45969220995903015,
        0.45969220995903015,
        0.5053315162658691,
        0.5179296731948853,
        0.5362753868103027,
        0.5619986653327942,
        0.5871409177780151,
        0.6169171929359436,
        0.6520060300827026,
        0.6813092231750488,
        0.7126780152320862,
        0.7269260883331299,
        0.7688786387443542,
        0.7769840359687805,
        0.7798573970794678,
        0.8069931268692017,
        0.8081444799900055,
        0.8081444799900055,
        0.808359682559967
      ],
      "expected": {
        "calibrated_mae": 0.116187
      }
    },
    {
      "context_key": "easy:budget-p2:random:25000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4672832190990448,
        0.4672832190990448,
        0.4672832190990448,
        0.513431966304779,
        0.5263534784317017,
        0.5445297956466675,
        0.5703348517417908,
        0.5951370000839233,
        0.6247290372848511,
        0.6591389179229736,
        0.6882011890411377,
        0.7189370393753052,
        0.732791006565094,
        0.7735801935195923,
        0.7815667986869812,
        0.7845059037208557,
        0.8104560971260071,
        0.8117462694644928,
        0.8117462694644928,
        0.8118988275527954
      ],
      "expected": {
        "calibrated_mae": 0.117058
      }
    },
    {
      "context_key": "easy:budget-p2:random:25000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4609696964422862,
        0.4609696964422862,
        0.4609696964422862,
        0.5075943470001221,
        0.5205560326576233,
        0.5389411449432373,
        0.56507408618927,
        0.5903711915016174,
        0.6205273270606995,
        0.6558287739753723,
        0.6854714751243591,
        0.7170348763465881,
        0.7311062812805176,
        0.7727326154708862,
        0.780892550945282,
        0.7838507294654846,
        0.8103975057601929,
        0.8116261661052704,
        0.8116261661052704,
        0.8117295503616333
      ],
      "expected": {
        "calibrated_mae": 0.115152
      }
    },
    {
      "context_key": "easy:budget-p2:random:25000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.460460901260376,
        0.460460901260376,
        0.460460901260376,
        0.5053936243057251,
        0.5180184245109558,
        0.5362032651901245,
        0.5616958737373352,
        0.5867869853973389,
        0.6164612174034119,
        0.6513475179672241,
        0.6805446147918701,
        0.711815357208252,
        0.7260776162147522,
        0.7681949138641357,
        0.7763549089431763,
        0.7791694402694702,
        0.8064673542976379,
        0.8076373040676117,
        0.8076373040676117,
        0.8078703880310059
      ],
      "expected": {
        "calibrated_mae": 0.116609
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4145946800708771,
        0.4145946800708771,
        0.4145946800708771,
        0.4814346730709076,
        0.5022023916244507,
        0.5353360772132874,
        0.5869688391685486,
        0.6328502297401428,
        0.6861087083816528,
        0.7405419945716858,
        0.7796008586883545,
        0.8149069547653198,
        0.8288386464118958,
        0.864264726638794,
        0.8715043067932129,
        0.8741686344146729,
        0.8925208449363708,
        0.8941333591938019,
        0.8941333591938019,
        0.8950079679489136
      ],
      "expected": {
        "calibrated_mae": 0.065141
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42261911431948346,
        0.42261911431948346,
        0.42261911431948346,
        0.4922175705432892,
        0.5133403539657593,
        0.545718252658844,
        0.5960666537284851,
        0.6398680806159973,
        0.6911696195602417,
        0.7435121536254883,
        0.7822418212890625,
        0.817033588886261,
        0.8306745886802673,
        0.8661515712738037,
        0.8734104037284851,
        0.87630295753479,
        0.8940804600715637,
        0.8958884179592133,
        0.8958884179592133,
        0.8967220783233643
      ],
      "expected": {
        "calibrated_mae": 0.068201
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4095809757709503,
        0.4095809757709503,
        0.4095809757709503,
        0.47909408807754517,
        0.5008946061134338,
        0.5347280502319336,
        0.587819516658783,
        0.6340073347091675,
        0.6872742176055908,
        0.7410706281661987,
        0.7801145315170288,
        0.8151858448982239,
        0.8288014531135559,
        0.8639166355133057,
        0.8713030815124512,
        0.8741098642349243,
        0.8922735452651978,
        0.8940724730491638,
        0.8940724730491638,
        0.8948452472686768
      ],
      "expected": {
        "calibrated_mae": 0.06438
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.41370275616645813,
        0.41370275616645813,
        0.41370275616645813,
        0.48124247789382935,
        0.502066969871521,
        0.5351999998092651,
        0.5870553851127625,
        0.6332329511642456,
        0.6869340538978577,
        0.7417949438095093,
        0.7811055183410645,
        0.8165547847747803,
        0.8303661346435547,
        0.8657427430152893,
        0.8730216026306152,
        0.8758443593978882,
        0.8938467502593994,
        0.8955830931663513,
        0.8955830931663513,
        0.8965650796890259
      ],
      "expected": {
        "calibrated_mae": 0.064354
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:1500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4608714083830516,
        0.4608714083830516,
        0.4608714083830516,
        0.5145282745361328,
        0.5291101932525635,
        0.550331711769104,
        0.5810152292251587,
        0.6078119277954102,
        0.6394544243812561,
        0.6736540198326111,
        0.7010759115219116,
        0.7303997874259949,
        0.7419252395629883,
        0.7791544795036316,
        0.7868801951408386,
        0.7898408770561218,
        0.8138519525527954,
        0.8156280815601349,
        0.8156280815601349,
        0.8163985013961792
      ],
      "expected": {
        "calibrated_mae": 0.114489
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:1500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4639958639939626,
        0.4639958639939626,
        0.4639958639939626,
        0.519177258014679,
        0.5341118574142456,
        0.5552780628204346,
        0.5862236022949219,
        0.6127325892448425,
        0.6442713141441345,
        0.6780705451965332,
        0.7055774331092834,
        0.7347132563591003,
        0.746077835559845,
        0.7831188440322876,
        0.7910019159317017,
        0.7941513657569885,
        0.8174731135368347,
        0.8194630444049835,
        0.8194630444049835,
        0.8201982378959656
      ],
      "expected": {
        "calibrated_mae": 0.114191
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:1500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4556841055552165,
        0.4556841055552165,
        0.4556841055552165,
        0.5124377608299255,
        0.5277653932571411,
        0.5495760440826416,
        0.58147794008255,
        0.6087084412574768,
        0.6408078074455261,
        0.6751241683959961,
        0.702711820602417,
        0.7320906519889832,
        0.7433726787567139,
        0.7803537845611572,
        0.788291335105896,
        0.7914209961891174,
        0.8151412606239319,
        0.8171387612819672,
        0.8171387612819672,
        0.8178528547286987
      ],
      "expected": {
        "calibrated_mae": 0.112827
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:1500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4572320183118184,
        0.4572320183118184,
        0.4572320183118184,
        0.5112883448600769,
        0.5259589552879333,
        0.5472812056541443,
        0.5783836245536804,
        0.6055598855018616,
        0.6377101540565491,
        0.6724640727043152,
        0.7003530859947205,
        0.730236828327179,
        0.7419398427009583,
        0.7798590064048767,
        0.7878167629241943,
        0.7909753918647766,
        0.8151085376739502,
        0.8170147836208344,
        0.8170147836208344,
        0.8179044723510742
      ],
      "expected": {
        "calibrated_mae": 0.112827
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:4000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47584911187489826,
        0.47584911187489826,
        0.47584911187489826,
        0.5180760025978088,
        0.529469907283783,
        0.5460448861122131,
        0.570145845413208,
        0.5922318696975708,
        0.6181751489639282,
        0.6479042172431946,
        0.6724068522453308,
        0.6998423337936401,
        0.7110571265220642,
        0.7479803562164307,
        0.7553867697715759,
        0.7580853700637817,
        0.7830894589424133,
        0.7844377756118774,
        0.7844377756118774,
        0.7849223017692566
      ],
      "expected": {
        "calibrated_mae": 0.131075
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:4000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.477348913749059,
        0.477348913749059,
        0.477348913749059,
        0.5209848880767822,
        0.5327862501144409,
        0.5495277643203735,
        0.5742135643959045,
        0.5964183211326599,
        0.6227239370346069,
        0.6525270342826843,
        0.6774011254310608,
        0.7050737738609314,
        0.7162978053092957,
        0.7533555030822754,
        0.7609686851501465,
        0.7638442516326904,
        0.7883185744285583,
        0.7898575067520142,
        0.7898575067520142,
        0.7903085350990295
      ],
      "expected": {
        "calibrated_mae": 0.129512
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:4000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.472881942987442,
        0.472881942987442,
        0.472881942987442,
        0.5171753168106079,
        0.5290766954421997,
        0.5460202097892761,
        0.5709865093231201,
        0.5935131311416626,
        0.6201505064964294,
        0.6503942012786865,
        0.6754917502403259,
        0.7035151720046997,
        0.7147151827812195,
        0.7519679069519043,
        0.759598970413208,
        0.7624486684799194,
        0.7872539162635803,
        0.7887435555458069,
        0.7887435555458069,
        0.7891755700111389
      ],
      "expected": {
        "calibrated_mae": 0.128644
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:4000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47319483757019043,
        0.47319483757019043,
        0.47319483757019043,
        0.515299379825592,
        0.5266872048377991,
        0.5432137846946716,
        0.5673279762268066,
        0.5895492434501648,
        0.6158134341239929,
        0.6458765864372253,
        0.6708728671073914,
        0.6989679336547852,
        0.7105175256729126,
        0.7484922409057617,
        0.7561171054840088,
        0.7589300870895386,
        0.7843664884567261,
        0.7857810258865356,
        0.7857810258865356,
        0.7863105535507202
      ],
      "expected": {
        "calibrated_mae": 0.129741
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:10000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4743926227092743,
        0.4743926227092743,
        0.4743926227092743,
        0.5201468467712402,
        0.5329165458679199,
        0.5518303513526917,
        0.5793707966804504,
        0.6049181222915649,
        0.6355635523796082,
        0.6704098582267761,
        0.6990196108818054,
        0.7292396426200867,
        0.7420769333839417,
        0.7799273133277893,
        0.7870988249778748,
        0.7901152968406677,
        0.8138120770454407,
        0.8151455819606781,
        0.8151455819606781,
        0.8157115578651428
      ],
      "expected": {
        "calibrated_mae": 0.116979
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:10000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.479509433110555,
        0.479509433110555,
        0.479509433110555,
        0.5261760354042053,
        0.5392153263092041,
        0.5578973293304443,
        0.5853917002677917,
        0.610418975353241,
        0.640652596950531,
        0.6746850609779358,
        0.7030476331710815,
        0.7327974438667297,
        0.7453550696372986,
        0.7827646136283875,
        0.790013313293457,
        0.7931729555130005,
        0.8162767291069031,
        0.8178247213363647,
        0.8178247213363647,
        0.8183446526527405
      ],
      "expected": {
        "calibrated_mae": 0.117776
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:10000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4705673158168793,
        0.4705673158168793,
        0.4705673158168793,
        0.5186084508895874,
        0.5319713354110718,
        0.5513200759887695,
        0.5799401998519897,
        0.6060240864753723,
        0.6373937726020813,
        0.6727340817451477,
        0.7018312215805054,
        0.7323847413063049,
        0.745073139667511,
        0.7827644348144531,
        0.7900726199150085,
        0.7932181358337402,
        0.8164793848991394,
        0.8179657161235809,
        0.8179657161235809,
        0.8184573650360107
      ],
      "expected": {
        "calibrated_mae": 0.114868
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:10000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4711306591828664,
        0.4711306591828664,
        0.4711306591828664,
        0.5171604156494141,
        0.5299900770187378,
        0.5488660931587219,
        0.576407253742218,
        0.601997971534729,
        0.6327686905860901,
        0.6677189469337463,
        0.696608304977417,
        0.7273350358009338,
        0.7403910160064697,
        0.7792142033576965,
        0.7866230607032776,
        0.7898086309432983,
        0.8139229416847229,
        0.8153700828552246,
        0.8153700828552246,
        0.8160179257392883
      ],
      "expected": {
        "calibrated_mae": 0.116078
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:25000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4630512297153473,
        0.4630512297153473,
        0.4630512297153473,
        0.5103113651275635,
        0.5234702825546265,
        0.5430005192756653,
        0.5709092020988464,
        0.5979210734367371,
        0.6302832961082458,
        0.6684433817863464,
        0.7003596425056458,
        0.7340238690376282,
        0.7491713762283325,
        0.7926608920097351,
        0.8008968234062195,
        0.8042320013046265,
        0.830510675907135,
        0.8318112194538116,
        0.8318112194538116,
        0.8322768211364746
      ],
      "expected": {
        "calibrated_mae": 0.10691
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:25000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46983123819033307,
        0.46983123819033307,
        0.46983123819033307,
        0.5179077386856079,
        0.5314342975616455,
        0.5507957935333252,
        0.5787764191627502,
        0.6053990125656128,
        0.6375036835670471,
        0.6748484373092651,
        0.7064191699028015,
        0.7393643856048584,
        0.7541019320487976,
        0.7964532375335693,
        0.8045498132705688,
        0.8079354763031006,
        0.8331328630447388,
        0.8345716893672943,
        0.8345716893672943,
        0.8349618911743164
      ],
      "expected": {
        "calibrated_mae": 0.107988
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:25000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4618592957655589,
        0.4618592957655589,
        0.4618592957655589,
        0.5108307600021362,
        0.5245195031166077,
        0.5443238019943237,
        0.5729937553405762,
        0.6003994941711426,
        0.6334523558616638,
        0.6720637083053589,
        0.7044863700866699,
        0.7384847402572632,
        0.7534962892532349,
        0.7967211008071899,
        0.805025041103363,
        0.8084594011306763,
        0.8341267108917236,
        0.8355008065700531,
        0.8355008065700531,
        0.8358678221702576
      ],
      "expected": {
        "calibrated_mae": 0.105086
      }
    },
    {
      "context_key": "easy:budget-p2:clear-greedy:25000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46268634001413983,
        0.46268634001413983,
        0.46268634001413983,
        0.5100993514060974,
        0.5234289169311523,
        0.5430082678794861,
        0.570935070514679,
        0.5980961322784424,
        0.6305620074272156,
        0.6686984300613403,
        0.7006538510322571,
        0.7343689203262329,
        0.7496170997619629,
        0.7934418320655823,
        0.8017577528953552,
        0.8050916194915771,
        0.831497311592102,
        0.8328391015529633,
        0.8328391015529633,
        0.8333473205566406
      ],
      "expected": {
        "calibrated_mae": 0.10647
      }
    },
    {
      "context_key": "easy:budget-p2:survival:500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4209974805514018,
        0.4209974805514018,
        0.4209974805514018,
        0.488227516412735,
        0.5086508393287659,
        0.540654182434082,
        0.5895666480064392,
        0.633241593837738,
        0.6843788027763367,
        0.7368288636207581,
        0.7752403616905212,
        0.8105301856994629,
        0.8246569633483887,
        0.860896110534668,
        0.8683515787124634,
        0.8710169792175293,
        0.8900298476219177,
        0.891616553068161,
        0.891616553068161,
        0.8924134373664856
      ],
      "expected": {
        "calibrated_mae": 0.068542
      }
    },
    {
      "context_key": "easy:budget-p2:survival:500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4297222097714742,
        0.4297222097714742,
        0.4297222097714742,
        0.4993038475513458,
        0.5200360417366028,
        0.5513228178024292,
        0.5992244482040405,
        0.6411095261573792,
        0.6905199885368347,
        0.7409937381744385,
        0.7789496183395386,
        0.8135312795639038,
        0.8272659182548523,
        0.8632478713989258,
        0.8706759214401245,
        0.873557984828949,
        0.8918108940124512,
        0.893593817949295,
        0.893593817949295,
        0.8943548798561096
      ],
      "expected": {
        "calibrated_mae": 0.071688
      }
    },
    {
      "context_key": "easy:budget-p2:survival:500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.41812532146771747,
        0.41812532146771747,
        0.41812532146771747,
        0.4879964292049408,
        0.509198009967804,
        0.5414578914642334,
        0.5911076068878174,
        0.6345932483673096,
        0.6854200959205627,
        0.7371357679367065,
        0.7754733562469482,
        0.8104967474937439,
        0.8243227005004883,
        0.8602771162986755,
        0.8678737282752991,
        0.8706700205802917,
        0.8894290924072266,
        0.8911795318126678,
        0.8911795318126678,
        0.8918567299842834
      ],
      "expected": {
        "calibrated_mae": 0.06856
      }
    },
    {
      "context_key": "easy:budget-p2:survival:500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42162341872851056,
        0.42162341872851056,
        0.42162341872851056,
        0.4893324077129364,
        0.5096644759178162,
        0.5413418412208557,
        0.5899174809455872,
        0.6334446668624878,
        0.6846610307693481,
        0.7373559474945068,
        0.7760310173034668,
        0.8115960359573364,
        0.8257110118865967,
        0.8621639013290405,
        0.8697047829627991,
        0.8725278377532959,
        0.8912565112113953,
        0.8929549157619476,
        0.8929549157619476,
        0.8938481211662292
      ],
      "expected": {
        "calibrated_mae": 0.068225
      }
    },
    {
      "context_key": "easy:budget-p2:survival:1500:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46504013737042743,
        0.46504013737042743,
        0.46504013737042743,
        0.5177570581436157,
        0.5319727659225464,
        0.5525070428848267,
        0.5820274353027344,
        0.6080547571182251,
        0.6388388276100159,
        0.6719812154769897,
        0.6986781358718872,
        0.7274661660194397,
        0.7388861775398254,
        0.775793731212616,
        0.7834413647651672,
        0.7862504720687866,
        0.8103702664375305,
        0.8120385408401489,
        0.8120385408401489,
        0.8126903176307678
      ],
      "expected": {
        "calibrated_mae": 0.1173
      }
    },
    {
      "context_key": "easy:budget-p2:survival:1500:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46845849355061847,
        0.46845849355061847,
        0.46845849355061847,
        0.5226458311080933,
        0.5372314453125,
        0.5577350854873657,
        0.5875888466835022,
        0.6133880615234375,
        0.6441099047660828,
        0.6769040822982788,
        0.7037003040313721,
        0.7322754859924316,
        0.7435155510902405,
        0.7801249027252197,
        0.7879159450531006,
        0.7909103631973267,
        0.8142467141151428,
        0.8161296844482422,
        0.8161296844482422,
        0.816754937171936
      ],
      "expected": {
        "calibrated_mae": 0.116941
      }
    },
    {
      "context_key": "easy:budget-p2:survival:1500:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4614015817642212,
        0.4614015817642212,
        0.4614015817642212,
        0.516698956489563,
        0.5314985513687134,
        0.5523648858070374,
        0.5827591419219971,
        0.6090110540390015,
        0.6400810480117798,
        0.673273503780365,
        0.7001284956932068,
        0.7289865612983704,
        0.740190863609314,
        0.7768893241882324,
        0.7847362160682678,
        0.7877015471458435,
        0.8114868402481079,
        0.8133470416069031,
        0.8133470416069031,
        0.8139287233352661
      ],
      "expected": {
        "calibrated_mae": 0.116098
      }
    },
    {
      "context_key": "easy:budget-p2:survival:1500:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4623129665851593,
        0.4623129665851593,
        0.4623129665851593,
        0.5149751305580139,
        0.5291740894317627,
        0.5496231317520142,
        0.579293429851532,
        0.6055297255516052,
        0.636660099029541,
        0.6702629327774048,
        0.6974180340766907,
        0.7267857193946838,
        0.738430380821228,
        0.7761358022689819,
        0.7840340733528137,
        0.7870172262191772,
        0.8113385438919067,
        0.8131159842014313,
        0.8131159842014313,
        0.8138687610626221
      ],
      "expected": {
        "calibrated_mae": 0.116001
      }
    },
    {
      "context_key": "easy:budget-p2:survival:4000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4791115125020345,
        0.4791115125020345,
        0.4791115125020345,
        0.5204591155052185,
        0.5315867066383362,
        0.5476818680763245,
        0.5709094405174255,
        0.5924522280693054,
        0.6177008152008057,
        0.6465317606925964,
        0.6703220009803772,
        0.6971423029899597,
        0.7081982493400574,
        0.7446069717407227,
        0.7518759965896606,
        0.7543689012527466,
        0.7793706655502319,
        0.7805854380130768,
        0.7805854380130768,
        0.780940592288971
      ],
      "expected": {
        "calibrated_mae": 0.133648
      }
    },
    {
      "context_key": "easy:budget-p2:survival:4000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4809354444344838,
        0.4809354444344838,
        0.4809354444344838,
        0.5236483812332153,
        0.535194993019104,
        0.5514625906944275,
        0.5753047466278076,
        0.5969995856285095,
        0.6226406693458557,
        0.6515893340110779,
        0.6757708191871643,
        0.702817976474762,
        0.7138797044754028,
        0.7503448724746704,
        0.7578151226043701,
        0.7604846358299255,
        0.7849054336547852,
        0.7863139808177948,
        0.7863139808177948,
        0.7866430878639221
      ],
      "expected": {
        "calibrated_mae": 0.132027
      }
    },
    {
      "context_key": "easy:budget-p2:survival:4000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4773901402950287,
        0.4773901402950287,
        0.4773901402950287,
        0.5204578042030334,
        0.5320225954055786,
        0.5483574867248535,
        0.5722682476043701,
        0.5941385626792908,
        0.6199560761451721,
        0.6492244601249695,
        0.6735610365867615,
        0.7009248733520508,
        0.7119636535644531,
        0.748661994934082,
        0.7561386227607727,
        0.7587727904319763,
        0.7835504412651062,
        0.7848903834819794,
        0.7848903834819794,
        0.7851859331130981
      ],
      "expected": {
        "calibrated_mae": 0.131548
      }
    },
    {
      "context_key": "easy:budget-p2:survival:4000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.476937214533488,
        0.476937214533488,
        0.476937214533488,
        0.5179108381271362,
        0.5289997458457947,
        0.5449815392494202,
        0.5681315064430237,
        0.5897558331489563,
        0.6152474284172058,
        0.6443459391593933,
        0.6685730814933777,
        0.6959902048110962,
        0.7073767185211182,
        0.7448182702064514,
        0.7523106932640076,
        0.7548900246620178,
        0.7803872227668762,
        0.7816572487354279,
        0.7816572487354279,
        0.7820448279380798
      ],
      "expected": {
        "calibrated_mae": 0.132557
      }
    },
    {
      "context_key": "easy:budget-p2:survival:10000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4782674511273702,
        0.4782674511273702,
        0.4782674511273702,
        0.5232762694358826,
        0.5357822775840759,
        0.5541250705718994,
        0.5805617570877075,
        0.605280339717865,
        0.6348716020584106,
        0.6683288812637329,
        0.6959167122840881,
        0.7253684997558594,
        0.7379933595657349,
        0.7755470871925354,
        0.7826830744743347,
        0.785563588142395,
        0.8095399737358093,
        0.8107897639274597,
        0.8107897639274597,
        0.811240553855896
      ],
      "expected": {
        "calibrated_mae": 0.120215
      }
    },
    {
      "context_key": "easy:budget-p2:survival:10000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4835817913214366,
        0.4835817913214366,
        0.4835817913214366,
        0.5293840765953064,
        0.5421653389930725,
        0.5602968335151672,
        0.5867607593536377,
        0.6110413670539856,
        0.6403160691261292,
        0.6730832457542419,
        0.7004845142364502,
        0.7294792532920837,
        0.7418171167373657,
        0.778834879398346,
        0.7860358953475952,
        0.7890546917915344,
        0.8123294115066528,
        0.8137868940830231,
        0.8137868940830231,
        0.8141968250274658
      ],
      "expected": {
        "calibrated_mae": 0.120859
      }
    },
    {
      "context_key": "easy:budget-p2:survival:10000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4758264521757762,
        0.4758264521757762,
        0.4758264521757762,
        0.5228000283241272,
        0.5358084440231323,
        0.5544266700744629,
        0.5816836953163147,
        0.6067551970481873,
        0.6368666887283325,
        0.6706727743148804,
        0.6986681222915649,
        0.7284035682678223,
        0.740881085395813,
        0.7782977223396301,
        0.7855684757232666,
        0.7885764837265015,
        0.8121254444122314,
        0.8135154545307159,
        0.8135154545307159,
        0.8138826489448547
      ],
      "expected": {
        "calibrated_mae": 0.118553
      }
    },
    {
      "context_key": "easy:budget-p2:survival:10000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4755470355351766,
        0.4755470355351766,
        0.4755470355351766,
        0.5205270648002625,
        0.5330489277839661,
        0.5512690544128418,
        0.5775914788246155,
        0.6022841930389404,
        0.6319127678871155,
        0.6654059886932373,
        0.6932199001312256,
        0.7231238484382629,
        0.735963761806488,
        0.7745068073272705,
        0.7818927764892578,
        0.7849189639091492,
        0.8093854784965515,
        0.8107343316078186,
        0.8107343316078186,
        0.8112545609474182
      ],
      "expected": {
        "calibrated_mae": 0.119574
      }
    },
    {
      "context_key": "easy:budget-p2:survival:25000:onboarding",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4651063084602356,
        0.4651063084602356,
        0.4651063084602356,
        0.5111963748931885,
        0.5240894556045532,
        0.5431070923805237,
        0.5700808763504028,
        0.5965223908424377,
        0.6280812621116638,
        0.665078341960907,
        0.6961349248886108,
        0.7290797233581543,
        0.7440721392631531,
        0.7873860001564026,
        0.7956336140632629,
        0.7988111972808838,
        0.8256216049194336,
        0.8268417119979858,
        0.8268417119979858,
        0.8271674513816833
      ],
      "expected": {
        "calibrated_mae": 0.109754
      }
    },
    {
      "context_key": "easy:budget-p2:survival:25000:growth",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4723678231239319,
        0.4723678231239319,
        0.4723678231239319,
        0.5193358063697815,
        0.5326324701309204,
        0.5515275001525879,
        0.5786594748497009,
        0.6047720909118652,
        0.636142373085022,
        0.6724197268486023,
        0.7031718492507935,
        0.7353923320770264,
        0.7499571442604065,
        0.7920048236846924,
        0.8000970482826233,
        0.8033382892608643,
        0.8289200663566589,
        0.8302837908267975,
        0.8302837908267975,
        0.8305456042289734
      ],
      "expected": {
        "calibrated_mae": 0.110656
      }
    },
    {
      "context_key": "easy:budget-p2:survival:25000:mature",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46506062150001526,
        0.46506062150001526,
        0.46506062150001526,
        0.5126877427101135,
        0.5260786414146423,
        0.5453005433082581,
        0.5729327201843262,
        0.5996894836425781,
        0.6318293213844299,
        0.6691970229148865,
        0.700684130191803,
        0.733874499797821,
        0.7486935257911682,
        0.7916350960731506,
        0.7999303340911865,
        0.803205668926239,
        0.8293417692184448,
        0.8306301236152649,
        0.8306301236152649,
        0.8308528661727905
      ],
      "expected": {
        "calibrated_mae": 0.108219
      }
    },
    {
      "context_key": "easy:budget-p2:survival:25000:plateau",
      "context": {
        "difficulty": "easy",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4650580982367198,
        0.4650580982367198,
        0.4650580982367198,
        0.5111148357391357,
        0.5241649746894836,
        0.5431941151618958,
        0.5701611638069153,
        0.5967336297035217,
        0.6283679604530334,
        0.6653324365615845,
        0.696398913860321,
        0.7293458580970764,
        0.7444183826446533,
        0.788025438785553,
        0.7963557243347168,
        0.7995175123214722,
        0.8264765739440918,
        0.8277336657047272,
        0.8277336657047272,
        0.8280963897705078
      ],
      "expected": {
        "calibrated_mae": 0.109442
      }
    },
    {
      "context_key": "normal:triplet-p1:random:500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4376754363377889,
        0.4376754363377889,
        0.4376754363377889,
        0.5066056847572327,
        0.5252805948257446,
        0.5518072247505188,
        0.589239776134491,
        0.6235136389732361,
        0.665489137172699,
        0.7111905813217163,
        0.7465102672576904,
        0.7824463248252869,
        0.7975634336471558,
        0.8368266224861145,
        0.8449714779853821,
        0.8475476503372192,
        0.8690600991249084,
        0.8704076111316681,
        0.8704076111316681,
        0.8709613084793091
      ],
      "expected": {
        "calibrated_mae": 0.083821
      }
    },
    {
      "context_key": "normal:triplet-p1:random:500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4519597291946411,
        0.4519597291946411,
        0.4519597291946411,
        0.5200806856155396,
        0.5388432145118713,
        0.564609706401825,
        0.6015667915344238,
        0.6346523761749268,
        0.6753700375556946,
        0.7189069986343384,
        0.7530811429023743,
        0.7872251272201538,
        0.8013865351676941,
        0.8389160633087158,
        0.8467803001403809,
        0.8494250774383545,
        0.8696472644805908,
        0.8711262047290802,
        0.8711262047290802,
        0.8716192245483398
      ],
      "expected": {
        "calibrated_mae": 0.088056
      }
    },
    {
      "context_key": "normal:triplet-p1:random:500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4358523488044739,
        0.4358523488044739,
        0.4358523488044739,
        0.506402850151062,
        0.5255724787712097,
        0.5522501468658447,
        0.5908459424972534,
        0.6256731748580933,
        0.6683902740478516,
        0.7144919037818909,
        0.7501333355903625,
        0.7859458923339844,
        0.800659716129303,
        0.8391097784042358,
        0.8472318649291992,
        0.8499064445495605,
        0.87066251039505,
        0.8721584677696228,
        0.8721584677696228,
        0.8725751638412476
      ],
      "expected": {
        "calibrated_mae": 0.082551
      }
    },
    {
      "context_key": "normal:triplet-p1:random:500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4371105134487152,
        0.4371105134487152,
        0.4371105134487152,
        0.5054152607917786,
        0.5241163372993469,
        0.5505259037017822,
        0.5882219672203064,
        0.6227146983146667,
        0.6647924184799194,
        0.7104885578155518,
        0.7457942962646484,
        0.7818708419799805,
        0.7968854308128357,
        0.8363515138626099,
        0.8445830941200256,
        0.8472660779953003,
        0.868667721748352,
        0.8701356649398804,
        0.8701356649398804,
        0.870771050453186
      ],
      "expected": {
        "calibrated_mae": 0.083676
      }
    },
    {
      "context_key": "normal:triplet-p1:random:1500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4659041265646617,
        0.4659041265646617,
        0.4659041265646617,
        0.5138064026832581,
        0.5267041921615601,
        0.5444261431694031,
        0.5694950222969055,
        0.5927129983901978,
        0.6209956407546997,
        0.6526436805725098,
        0.6783565878868103,
        0.7075048089027405,
        0.7195247411727905,
        0.7575950026512146,
        0.7655112147331238,
        0.7680286169052124,
        0.7932832837104797,
        0.794636607170105,
        0.794636607170105,
        0.7951027750968933
      ],
      "expected": {
        "calibrated_mae": 0.124419
      }
    },
    {
      "context_key": "normal:triplet-p1:random:1500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47361589471499127,
        0.47361589471499127,
        0.47361589471499127,
        0.5215692520141602,
        0.5346996188163757,
        0.552196204662323,
        0.5774209499359131,
        0.6002822518348694,
        0.6283614635467529,
        0.6593577861785889,
        0.6848781704902649,
        0.7133595943450928,
        0.7249605655670166,
        0.7618739604949951,
        0.7697089314460754,
        0.7722969651222229,
        0.7962914109230042,
        0.7977621555328369,
        0.7977621555328369,
        0.7981600165367126
      ],
      "expected": {
        "calibrated_mae": 0.125416
      }
    },
    {
      "context_key": "normal:triplet-p1:random:1500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46423935890197754,
        0.46423935890197754,
        0.46423935890197754,
        0.514282763004303,
        0.5276502370834351,
        0.5456488728523254,
        0.5717232823371887,
        0.5953657627105713,
        0.6242796778678894,
        0.6563689708709717,
        0.6824607849121094,
        0.7118754386901855,
        0.7236992716789246,
        0.7614575624465942,
        0.769488513469696,
        0.7721555233001709,
        0.7968148589134216,
        0.7983437180519104,
        0.7983437180519104,
        0.7987170219421387
      ],
      "expected": {
        "calibrated_mae": 0.122565
      }
    },
    {
      "context_key": "normal:triplet-p1:random:1500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4618539313475291,
        0.4618539313475291,
        0.4618539313475291,
        0.5096198320388794,
        0.5226088762283325,
        0.5403914451599121,
        0.565823495388031,
        0.5893734693527222,
        0.6180199384689331,
        0.6500225067138672,
        0.6760730743408203,
        0.7056578397750854,
        0.7178195118904114,
        0.7564234733581543,
        0.764529287815094,
        0.7671351432800293,
        0.7925633192062378,
        0.7940095663070679,
        0.7940095663070679,
        0.7945433855056763
      ],
      "expected": {
        "calibrated_mae": 0.123398
      }
    },
    {
      "context_key": "normal:triplet-p1:random:4000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4789444903532664,
        0.4789444903532664,
        0.4789444903532664,
        0.5184897184371948,
        0.5293988585472107,
        0.5444797277450562,
        0.5657065510749817,
        0.5861117839813232,
        0.6102697253227234,
        0.6385324597358704,
        0.6616206765174866,
        0.6882691979408264,
        0.6995688080787659,
        0.73610919713974,
        0.74347323179245,
        0.7456305623054504,
        0.7711377143859863,
        0.7720906734466553,
        0.7720906734466553,
        0.7723591327667236
      ],
      "expected": {
        "calibrated_mae": 0.136988
      }
    },
    {
      "context_key": "normal:triplet-p1:random:4000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48452168703079224,
        0.48452168703079224,
        0.48452168703079224,
        0.5243783593177795,
        0.5355566740036011,
        0.5505496263504028,
        0.5720425844192505,
        0.5923163890838623,
        0.6165603995323181,
        0.6445294618606567,
        0.6676526069641113,
        0.694023072719574,
        0.705105185508728,
        0.7409088015556335,
        0.7482824325561523,
        0.750516414642334,
        0.7750733494758606,
        0.7761574685573578,
        0.7761574685573578,
        0.7763664722442627
      ],
      "expected": {
        "calibrated_mae": 0.136978
      }
    },
    {
      "context_key": "normal:triplet-p1:random:4000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4779817561308543,
        0.4779817561308543,
        0.4779817561308543,
        0.5192294120788574,
        0.5305836200714111,
        0.5459784865379333,
        0.5680755376815796,
        0.5889666080474854,
        0.6139134764671326,
        0.6428316831588745,
        0.6665737628936768,
        0.693842887878418,
        0.7051324248313904,
        0.7418678402900696,
        0.7493959665298462,
        0.7517009973526001,
        0.7768710255622864,
        0.777956485748291,
        0.777956485748291,
        0.7781593203544617
      ],
      "expected": {
        "calibrated_mae": 0.134388
      }
    },
    {
      "context_key": "normal:triplet-p1:random:4000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4751530687014262,
        0.4751530687014262,
        0.4751530687014262,
        0.5143789052963257,
        0.5253424644470215,
        0.5404658317565918,
        0.561866819858551,
        0.5825124382972717,
        0.6070212721824646,
        0.6355686783790588,
        0.6590239405632019,
        0.6860847473144531,
        0.6976083517074585,
        0.734853208065033,
        0.7424027323722839,
        0.7445826530456543,
        0.7705122232437134,
        0.7715309262275696,
        0.7715309262275696,
        0.7718237638473511
      ],
      "expected": {
        "calibrated_mae": 0.136044
      }
    },
    {
      "context_key": "normal:triplet-p1:random:10000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48004058996836346,
        0.48004058996836346,
        0.48004058996836346,
        0.5243203639984131,
        0.5366554856300354,
        0.5538064241409302,
        0.577591061592102,
        0.6003223657608032,
        0.6275681853294373,
        0.6588312983512878,
        0.6843705773353577,
        0.7126336693763733,
        0.7250420451164246,
        0.7623019218444824,
        0.7696177959442139,
        0.7721378803253174,
        0.7969392538070679,
        0.7979727983474731,
        0.7979727983474731,
        0.79830402135849
      ],
      "expected": {
        "calibrated_mae": 0.126681
      }
    },
    {
      "context_key": "normal:triplet-p1:random:10000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48896873990694684,
        0.48896873990694684,
        0.48896873990694684,
        0.532776951789856,
        0.5452150702476501,
        0.5619292259216309,
        0.5854926705360413,
        0.6076062321662903,
        0.6343427896499634,
        0.6646373867988586,
        0.6897176504135132,
        0.7171356678009033,
        0.7290375232696533,
        0.7650936841964722,
        0.7723160982131958,
        0.7748814821243286,
        0.798602819442749,
        0.7997706234455109,
        0.7997706234455109,
        0.800030529499054
      ],
      "expected": {
        "calibrated_mae": 0.128632
      }
    },
    {
      "context_key": "normal:triplet-p1:random:10000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47901766498883563,
        0.47901766498883563,
        0.47901766498883563,
        0.5251369476318359,
        0.5379303097724915,
        0.5554088950157166,
        0.5801492929458618,
        0.6033942103385925,
        0.6313778162002563,
        0.663266658782959,
        0.6893657445907593,
        0.7180536389350891,
        0.730339527130127,
        0.7674012184143066,
        0.7747981548309326,
        0.7774500846862793,
        0.801646888256073,
        0.8028185367584229,
        0.8028185367584229,
        0.8030579090118408
      ],
      "expected": {
        "calibrated_mae": 0.124439
      }
    },
    {
      "context_key": "normal:triplet-p1:random:10000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4763011336326599,
        0.4763011336326599,
        0.4763011336326599,
        0.5202015042304993,
        0.5325925946235657,
        0.5497061610221863,
        0.5736314058303833,
        0.596537172794342,
        0.6239674687385559,
        0.6553824543952942,
        0.681144654750824,
        0.7097300887107849,
        0.7222487926483154,
        0.7601161003112793,
        0.7676154971122742,
        0.7701925039291382,
        0.795335590839386,
        0.7964536249637604,
        0.7964536249637604,
        0.7968339920043945
      ],
      "expected": {
        "calibrated_mae": 0.126169
      }
    },
    {
      "context_key": "normal:triplet-p1:random:25000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46501131852467853,
        0.46501131852467853,
        0.46501131852467853,
        0.5114052891731262,
        0.52467280626297,
        0.5433183908462524,
        0.569090723991394,
        0.5947277545928955,
        0.6249925494194031,
        0.6607432961463928,
        0.6900816559791565,
        0.7215132713317871,
        0.736031711101532,
        0.7776336669921875,
        0.7857931852340698,
        0.7885088324546814,
        0.8154001235961914,
        0.8164047300815582,
        0.8164047300815582,
        0.8166230320930481
      ],
      "expected": {
        "calibrated_mae": 0.114373
      }
    },
    {
      "context_key": "normal:triplet-p1:random:25000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4762674669424693,
        0.4762674669424693,
        0.4762674669424693,
        0.5226462483406067,
        0.5361519455909729,
        0.5544390678405762,
        0.5800119042396545,
        0.6049914360046387,
        0.6346532702445984,
        0.6691645979881287,
        0.6977753639221191,
        0.7279766798019409,
        0.7418018579483032,
        0.7815312743186951,
        0.7894150018692017,
        0.7921313643455505,
        0.8175670504570007,
        0.8186849355697632,
        0.8186849355697632,
        0.8188350200653076
      ],
      "expected": {
        "calibrated_mae": 0.116874
      }
    },
    {
      "context_key": "normal:triplet-p1:random:25000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4657313823699951,
        0.4657313823699951,
        0.4657313823699951,
        0.5138460993766785,
        0.5276443958282471,
        0.5466552376747131,
        0.5733467936515808,
        0.5995457768440247,
        0.6306769847869873,
        0.667134702205658,
        0.6971340775489807,
        0.7289857268333435,
        0.743377149105072,
        0.7846258878707886,
        0.7928119897842407,
        0.7956480979919434,
        0.8217283487319946,
        0.8228225409984589,
        0.8228225409984589,
        0.8229430317878723
      ],
      "expected": {
        "calibrated_mae": 0.111912
      }
    },
    {
      "context_key": "normal:triplet-p1:random:25000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4640159209569295,
        0.4640159209569295,
        0.4640159209569295,
        0.5100696682929993,
        0.523470401763916,
        0.5421355366706848,
        0.5680144429206848,
        0.5938366055488586,
        0.6242272257804871,
        0.6599705219268799,
        0.6893458962440491,
        0.720762312412262,
        0.7352922558784485,
        0.7770382165908813,
        0.7852504849433899,
        0.7879136204719543,
        0.8149119019508362,
        0.8159639537334442,
        0.8159639537334442,
        0.816210925579071
      ],
      "expected": {
        "calibrated_mae": 0.114227
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4256494343280792,
        0.4256494343280792,
        0.4256494343280792,
        0.4979853928089142,
        0.518481433391571,
        0.5485066175460815,
        0.5915287137031555,
        0.6306866407394409,
        0.678926408290863,
        0.7309183478355408,
        0.7701928019523621,
        0.8084157109260559,
        0.8239941596984863,
        0.8620348572731018,
        0.8695950508117676,
        0.8721926808357239,
        0.8911089897155762,
        0.8924087882041931,
        0.8924087882041931,
        0.8931372165679932
      ],
      "expected": {
        "calibrated_mae": 0.070058
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4396666884422302,
        0.4396666884422302,
        0.4396666884422302,
        0.5113693475723267,
        0.5318606495857239,
        0.5608507990837097,
        0.6031454801559448,
        0.6410033106803894,
        0.687891960144043,
        0.7375155687332153,
        0.7754930257797241,
        0.8117657899856567,
        0.8263976573944092,
        0.8630315661430359,
        0.8703630566596985,
        0.8730593919754028,
        0.8910305500030518,
        0.8924696147441864,
        0.8924696147441864,
        0.8931503891944885
      ],
      "expected": {
        "calibrated_mae": 0.075304
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4190796713034312,
        0.4190796713034312,
        0.4190796713034312,
        0.4935038387775421,
        0.514829695224762,
        0.5455514192581177,
        0.5908294916152954,
        0.6315567493438721,
        0.681800127029419,
        0.7352479696273804,
        0.7752729654312134,
        0.8134511113166809,
        0.8285015225410461,
        0.8652352690696716,
        0.8726993799209595,
        0.8753777742385864,
        0.8933465480804443,
        0.8947886824607849,
        0.8947886824607849,
        0.8954125642776489
      ],
      "expected": {
        "calibrated_mae": 0.067217
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4231818417708079,
        0.4231818417708079,
        0.4231818417708079,
        0.4960668683052063,
        0.5167975425720215,
        0.5471700429916382,
        0.5912460088729858,
        0.6313461661338806,
        0.6805266737937927,
        0.7331916093826294,
        0.7726697325706482,
        0.810977041721344,
        0.826337993144989,
        0.8640581369400024,
        0.8715946674346924,
        0.8743270635604858,
        0.8927264213562012,
        0.89415642619133,
        0.89415642619133,
        0.8949886560440063
      ],
      "expected": {
        "calibrated_mae": 0.068628
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:1500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.465877225001653,
        0.465877225001653,
        0.465877225001653,
        0.5174531936645508,
        0.5314785242080688,
        0.5511437058448792,
        0.5790912508964539,
        0.6046678423881531,
        0.636070191860199,
        0.6710729598999023,
        0.6994149684906006,
        0.7309682965278625,
        0.7437461018562317,
        0.7831904292106628,
        0.791306734085083,
        0.7942823171615601,
        0.8187425136566162,
        0.8202798664569855,
        0.8202798664569855,
        0.821044921875
      ],
      "expected": {
        "calibrated_mae": 0.113628
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:1500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.473270058631897,
        0.473270058631897,
        0.473270058631897,
        0.5249300599098206,
        0.5391794443130493,
        0.5585758090019226,
        0.5866696238517761,
        0.6118674278259277,
        0.6430358290672302,
        0.6773006319999695,
        0.7053415179252625,
        0.7360596656799316,
        0.7483704090118408,
        0.7866420745849609,
        0.7946584224700928,
        0.7977012395858765,
        0.8209861516952515,
        0.8226491212844849,
        0.8226491212844849,
        0.823342502117157
      ],
      "expected": {
        "calibrated_mae": 0.114886
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:1500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46033570170402527,
        0.46033570170402527,
        0.46033570170402527,
        0.5150109529495239,
        0.5297735333442688,
        0.550139307975769,
        0.5798211693763733,
        0.6063686609268188,
        0.6390677690505981,
        0.675097644329071,
        0.7041065096855164,
        0.736113429069519,
        0.748664915561676,
        0.7876678705215454,
        0.7959057688713074,
        0.799059271812439,
        0.8227770924568176,
        0.8245245516300201,
        0.8245245516300201,
        0.8252315521240234
      ],
      "expected": {
        "calibrated_mae": 0.110344
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:1500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46053945024808246,
        0.46053945024808246,
        0.46053945024808246,
        0.512791097164154,
        0.527042806148529,
        0.5470126271247864,
        0.5757588744163513,
        0.6020069122314453,
        0.6341571807861328,
        0.6698983907699585,
        0.6987857222557068,
        0.7309665083885193,
        0.7439121603965759,
        0.7839555144309998,
        0.7922825217247009,
        0.7954381704330444,
        0.8199277520179749,
        0.8216207325458527,
        0.8216207325458527,
        0.8225085139274597
      ],
      "expected": {
        "calibrated_mae": 0.111441
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:4000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48065779606501263,
        0.48065779606501263,
        0.48065779606501263,
        0.5220563411712646,
        0.533541202545166,
        0.5497210025787354,
        0.572756290435791,
        0.5946608185768127,
        0.6208482980728149,
        0.6514704823493958,
        0.6765795350074768,
        0.705366849899292,
        0.7174316048622131,
        0.7558469176292419,
        0.7635767459869385,
        0.7662496566772461,
        0.7917166352272034,
        0.7928929328918457,
        0.7928929328918457,
        0.7934201955795288
      ],
      "expected": {
        "calibrated_mae": 0.128873
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:4000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4857645233472188,
        0.4857645233472188,
        0.4857645233472188,
        0.5276599526405334,
        0.5394506454467773,
        0.5555724501609802,
        0.5789394378662109,
        0.6007508039474487,
        0.6270719170570374,
        0.6574227809906006,
        0.6825481653213501,
        0.7110175490379333,
        0.722845733165741,
        0.7605019211769104,
        0.7682152390480042,
        0.7709526419639587,
        0.7954509854316711,
        0.7967589199542999,
        0.7967589199542999,
        0.7972227931022644
      ],
      "expected": {
        "calibrated_mae": 0.12882
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:4000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47690339883168537,
        0.47690339883168537,
        0.47690339883168537,
        0.5206689834594727,
        0.5327787399291992,
        0.5495648980140686,
        0.5739742517471313,
        0.596751868724823,
        0.6242137551307678,
        0.6559606194496155,
        0.6820115447044373,
        0.7116735577583313,
        0.7237764000892639,
        0.762454628944397,
        0.7703694105148315,
        0.7732226848602295,
        0.7982550263404846,
        0.7995818555355072,
        0.7995818555355072,
        0.8000679612159729
      ],
      "expected": {
        "calibrated_mae": 0.125053
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:4000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47585223118464154,
        0.47585223118464154,
        0.47585223118464154,
        0.5174472332000732,
        0.5290682911872864,
        0.545430600643158,
        0.5688890218734741,
        0.5912380814552307,
        0.6180187463760376,
        0.6491905450820923,
        0.6748635768890381,
        0.7043033838272095,
        0.716681182384491,
        0.7560563683509827,
        0.7640251517295837,
        0.7668004035949707,
        0.7926909923553467,
        0.7939792275428772,
        0.7939792275428772,
        0.7945697903633118
      ],
      "expected": {
        "calibrated_mae": 0.126993
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:10000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4808267255624135,
        0.4808267255624135,
        0.4808267255624135,
        0.5270909667015076,
        0.5401328206062317,
        0.5586307644844055,
        0.5845683813095093,
        0.6092222929000854,
        0.6390846371650696,
        0.6733857989311218,
        0.7015025615692139,
        0.732161819934845,
        0.7455235719680786,
        0.7844104170799255,
        0.7919176816940308,
        0.7948746085166931,
        0.8191254734992981,
        0.8202973902225494,
        0.8202973902225494,
        0.8208681344985962
      ],
      "expected": {
        "calibrated_mae": 0.11731
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:10000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48973141113917035,
        0.48973141113917035,
        0.48973141113917035,
        0.5357434153556824,
        0.5489119291305542,
        0.5669341087341309,
        0.5925990343093872,
        0.6165534853935242,
        0.6458009481430054,
        0.6789642572402954,
        0.7064583897590637,
        0.7361034750938416,
        0.7488938570022583,
        0.7865413427352905,
        0.793944776058197,
        0.7969414591789246,
        0.8202120661735535,
        0.8215327262878418,
        0.8215327262878418,
        0.8220305442810059
      ],
      "expected": {
        "calibrated_mae": 0.119597
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:10000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4766838550567627,
        0.4766838550567627,
        0.4766838550567627,
        0.5254485607147217,
        0.539149284362793,
        0.5582950711250305,
        0.5857764482498169,
        0.61140376329422,
        0.6426078677177429,
        0.6781123876571655,
        0.7071303725242615,
        0.7384796738624573,
        0.7517508268356323,
        0.7903765439987183,
        0.7979571223258972,
        0.8010611534118652,
        0.8245291709899902,
        0.8258484303951263,
        0.8258484303951263,
        0.8263500928878784
      ],
      "expected": {
        "calibrated_mae": 0.113732
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:10000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47585071126619977,
        0.47585071126619977,
        0.47585071126619977,
        0.52242112159729,
        0.535634458065033,
        0.5542827844619751,
        0.5806742906570435,
        0.6057559847831726,
        0.636096715927124,
        0.6708516478538513,
        0.6993967294692993,
        0.7305928468704224,
        0.7441408634185791,
        0.7838097810745239,
        0.7915356755256653,
        0.7946300506591797,
        0.8191727995872498,
        0.8204775452613831,
        0.8204775452613831,
        0.8211368322372437
      ],
      "expected": {
        "calibrated_mae": 0.115778
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:25000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46645256876945496,
        0.46645256876945496,
        0.46645256876945496,
        0.5153164267539978,
        0.5292810201644897,
        0.5492366552352905,
        0.577073335647583,
        0.6044886708259583,
        0.6371031999588013,
        0.6755989789962769,
        0.7071771025657654,
        0.7406331300735474,
        0.7559455037117004,
        0.7988260388374329,
        0.8070701360702515,
        0.810185432434082,
        0.8362223505973816,
        0.8373364210128784,
        0.8373364210128784,
        0.8378148078918457
      ],
      "expected": {
        "calibrated_mae": 0.105853
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:25000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47746559977531433,
        0.47746559977531433,
        0.47746559977531433,
        0.5264886617660522,
        0.5407182574272156,
        0.5602722764015198,
        0.587842583656311,
        0.6145216226577759,
        0.6464254856109619,
        0.6835075616836548,
        0.7142153382301331,
        0.7462940812110901,
        0.7608749270439148,
        0.8018397092819214,
        0.8097860813140869,
        0.8128811120986938,
        0.8375764489173889,
        0.8388020992279053,
        0.8388020992279053,
        0.8392009139060974
      ],
      "expected": {
        "calibrated_mae": 0.108712
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:25000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4644203782081604,
        0.4644203782081604,
        0.4644203782081604,
        0.5156375765800476,
        0.5303069949150085,
        0.5508808493614197,
        0.5800653696060181,
        0.6083827018737793,
        0.6423106789588928,
        0.6819314360618591,
        0.7144356369972229,
        0.748509407043457,
        0.7637508511543274,
        0.8062692284584045,
        0.8145275115966797,
        0.8177745938301086,
        0.8428908586502075,
        0.8440861403942108,
        0.8440861403942108,
        0.8444841504096985
      ],
      "expected": {
        "calibrated_mae": 0.102373
      }
    },
    {
      "context_key": "normal:triplet-p1:clear-greedy:25000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46460583806037903,
        0.46460583806037903,
        0.46460583806037903,
        0.5137268900871277,
        0.5279420614242554,
        0.5480870604515076,
        0.5762826800346375,
        0.6041205525398254,
        0.637109637260437,
        0.6758532524108887,
        0.7076582908630371,
        0.7412532567977905,
        0.756665050983429,
        0.7998105883598328,
        0.8081258535385132,
        0.8112441301345825,
        0.8373293280601501,
        0.8385140299797058,
        0.8385140299797058,
        0.8390470743179321
      ],
      "expected": {
        "calibrated_mae": 0.104821
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4291892647743225,
        0.4291892647743225,
        0.4291892647743225,
        0.5003308057785034,
        0.5204635262489319,
        0.5498045086860657,
        0.5917766690254211,
        0.6302984356880188,
        0.6778507232666016,
        0.7287201285362244,
        0.767486035823822,
        0.8055053353309631,
        0.8211785554885864,
        0.8597334027290344,
        0.8674852252006531,
        0.870099663734436,
        0.8895336389541626,
        0.890839159488678,
        0.890839159488678,
        0.8915008306503296
      ],
      "expected": {
        "calibrated_mae": 0.071764
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4435364107290904,
        0.4435364107290904,
        0.4435364107290904,
        0.514197587966919,
        0.5343878865242004,
        0.562777578830719,
        0.6041139960289001,
        0.6413395404815674,
        0.6875020861625671,
        0.7360342144966125,
        0.773492693901062,
        0.809524655342102,
        0.8242034912109375,
        0.8611899018287659,
        0.8686814308166504,
        0.8713905811309814,
        0.8897555470466614,
        0.8912011086940765,
        0.8912011086940765,
        0.8918185830116272
      ],
      "expected": {
        "calibrated_mae": 0.077058
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42447637518246967,
        0.42447637518246967,
        0.42447637518246967,
        0.4975525140762329,
        0.5183891654014587,
        0.5482149124145508,
        0.5920612812042236,
        0.6317658424377441,
        0.6808472871780396,
        0.732767641544342,
        0.7720949053764343,
        0.8099427819252014,
        0.8250912427902222,
        0.86241614818573,
        0.8700854778289795,
        0.8727763891220093,
        0.8912893533706665,
        0.8927330076694489,
        0.8927330076694489,
        0.8932750225067139
      ],
      "expected": {
        "calibrated_mae": 0.069763
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4279642005761464,
        0.4279642005761464,
        0.4279642005761464,
        0.4993193447589874,
        0.5196030139923096,
        0.5490882396697998,
        0.5918023586273193,
        0.6310024261474609,
        0.6792072653770447,
        0.7305417656898499,
        0.7694488167762756,
        0.8075417280197144,
        0.8230398893356323,
        0.8614344596862793,
        0.86920166015625,
        0.8719459176063538,
        0.8909500241279602,
        0.8923826515674591,
        0.8923826515674591,
        0.893139123916626
      ],
      "expected": {
        "calibrated_mae": 0.070783
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:1500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4684296250343323,
        0.4684296250343323,
        0.4684296250343323,
        0.5192890167236328,
        0.5331217050552368,
        0.5524618029594421,
        0.5799160599708557,
        0.6051844954490662,
        0.6361370086669922,
        0.670341968536377,
        0.6980581283569336,
        0.7290412783622742,
        0.7416732907295227,
        0.7807693481445312,
        0.7888436913490295,
        0.7917193174362183,
        0.8163132667541504,
        0.8178010284900665,
        0.8178010284900665,
        0.8184657096862793
      ],
      "expected": {
        "calibrated_mae": 0.115496
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:1500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47592703501383465,
        0.47592703501383465,
        0.47592703501383465,
        0.526936948299408,
        0.5410177707672119,
        0.5601058602333069,
        0.5877324938774109,
        0.6126341223716736,
        0.643352746963501,
        0.6768643856048584,
        0.7043192386627197,
        0.7344905734062195,
        0.7466527819633484,
        0.7845420241355896,
        0.7925149202346802,
        0.7954631447792053,
        0.818821907043457,
        0.8204390704631805,
        0.8204390704631805,
        0.8210388422012329
      ],
      "expected": {
        "calibrated_mae": 0.116667
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:1500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4641369581222534,
        0.4641369581222534,
        0.4641369581222534,
        0.5177510976791382,
        0.5322343707084656,
        0.552129328250885,
        0.5810788869857788,
        0.6071326732635498,
        0.6391492486000061,
        0.6741944551467896,
        0.7024928331375122,
        0.7338565587997437,
        0.7462664246559143,
        0.7849458456039429,
        0.7931405305862427,
        0.7961824536323547,
        0.8200498223304749,
        0.8217341303825378,
        0.8217341303825378,
        0.8223251700401306
      ],
      "expected": {
        "calibrated_mae": 0.112716
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:1500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4637415011723836,
        0.4637415011723836,
        0.4637415011723836,
        0.5149568915367126,
        0.5289629697799683,
        0.5484982132911682,
        0.5765871405601501,
        0.6024150848388672,
        0.6339846253395081,
        0.6688370704650879,
        0.6970697045326233,
        0.7286490797996521,
        0.7414654493331909,
        0.7812235355377197,
        0.7895253300666809,
        0.7925601601600647,
        0.8172609806060791,
        0.8188927173614502,
        0.8188927173614502,
        0.8196662664413452
      ],
      "expected": {
        "calibrated_mae": 0.113597
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:4000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48273976643880206,
        0.48273976643880206,
        0.48273976643880206,
        0.5234923362731934,
        0.5348228812217712,
        0.5507332682609558,
        0.5732995271682739,
        0.5949508547782898,
        0.6207259893417358,
        0.6506686806678772,
        0.6751952767372131,
        0.7034025192260742,
        0.7153119444847107,
        0.7532961368560791,
        0.7609431147575378,
        0.7634631395339966,
        0.7890263795852661,
        0.7901196181774139,
        0.7901196181774139,
        0.7905325293540955
      ],
      "expected": {
        "calibrated_mae": 0.130676
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:4000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48804495731989544,
        0.48804495731989544,
        0.48804495731989544,
        0.5293288230895996,
        0.540982723236084,
        0.5568466782569885,
        0.5797640085220337,
        0.6013352274894714,
        0.6272523999214172,
        0.6569584012031555,
        0.6815332770347595,
        0.7094408273696899,
        0.7211183309555054,
        0.7583305835723877,
        0.7659677863121033,
        0.7685638070106506,
        0.793122410774231,
        0.7943530976772308,
        0.7943530976772308,
        0.7947097420692444
      ],
      "expected": {
        "calibrated_mae": 0.130527
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:4000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.480172594388326,
        0.480172594388326,
        0.480172594388326,
        0.5230709314346313,
        0.5349776148796082,
        0.5513988733291626,
        0.5751727819442749,
        0.5975774526596069,
        0.6244688630104065,
        0.6554034948348999,
        0.6807987093925476,
        0.7098012566566467,
        0.7217371463775635,
        0.7599599361419678,
        0.7677854895591736,
        0.7704785466194153,
        0.7956099510192871,
        0.7968441545963287,
        0.7968441545963287,
        0.79720538854599
      ],
      "expected": {
        "calibrated_mae": 0.127204
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:4000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4783334831396739,
        0.4783334831396739,
        0.4783334831396739,
        0.519106924533844,
        0.530551552772522,
        0.5465901494026184,
        0.569490909576416,
        0.5915302634239197,
        0.6178247332572937,
        0.6482607126235962,
        0.6733140349388123,
        0.702127993106842,
        0.714346170425415,
        0.7532925009727478,
        0.7611837387084961,
        0.763782799243927,
        0.7898272275924683,
        0.7910229563713074,
        0.7910229563713074,
        0.791488528251648
      ],
      "expected": {
        "calibrated_mae": 0.128989
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:10000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48327892025311786,
        0.48327892025311786,
        0.48327892025311786,
        0.528729259967804,
        0.5415652394294739,
        0.5596755146980286,
        0.5850005149841309,
        0.6092371940612793,
        0.6385160684585571,
        0.6718873977661133,
        0.6992825865745544,
        0.7292977571487427,
        0.7424740791320801,
        0.781058132648468,
        0.7885425090789795,
        0.791390597820282,
        0.8158774375915527,
        0.8169960379600525,
        0.8169960379600525,
        0.817460834980011
      ],
      "expected": {
        "calibrated_mae": 0.119533
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:10000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4922591249148051,
        0.4922591249148051,
        0.4922591249148051,
        0.5374839901924133,
        0.5504685044288635,
        0.5681320428848267,
        0.5932319164276123,
        0.6168062090873718,
        0.6455076336860657,
        0.6778204441070557,
        0.7046515345573425,
        0.7336872220039368,
        0.746296763420105,
        0.783603310585022,
        0.7909781336784363,
        0.7938700318336487,
        0.8172997236251831,
        0.8185655772686005,
        0.8185655772686005,
        0.8189626932144165
      ],
      "expected": {
        "calibrated_mae": 0.121673
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:10000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48043246070543927,
        0.48043246070543927,
        0.48043246070543927,
        0.5281575918197632,
        0.541590690612793,
        0.5602315664291382,
        0.5868892669677734,
        0.6119309663772583,
        0.6423269510269165,
        0.6767001748085022,
        0.704884946346283,
        0.7354864478111267,
        0.7485557794570923,
        0.7868878245353699,
        0.7944485545158386,
        0.7974405884742737,
        0.8211745023727417,
        0.8224350810050964,
        0.8224350810050964,
        0.8228192925453186
      ],
      "expected": {
        "calibrated_mae": 0.116426
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:10000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47873109579086304,
        0.47873109579086304,
        0.47873109579086304,
        0.5242878198623657,
        0.5372708439826965,
        0.5554687976837158,
        0.5811437964439392,
        0.6057373285293579,
        0.6354049444198608,
        0.6691617369651794,
        0.6969427466392517,
        0.7274499535560608,
        0.7408074736595154,
        0.7801960110664368,
        0.7879098057746887,
        0.7908756732940674,
        0.8157209157943726,
        0.816962331533432,
        0.816962331533432,
        0.8175055980682373
      ],
      "expected": {
        "calibrated_mae": 0.118218
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:25000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46709079543749493,
        0.46709079543749493,
        0.46709079543749493,
        0.514872133731842,
        0.528633713722229,
        0.5482282638549805,
        0.5754753351211548,
        0.6026168465614319,
        0.6348247528076172,
        0.6726015210151672,
        0.7036994695663452,
        0.7367376089096069,
        0.7520149946212769,
        0.7949614524841309,
        0.8032652735710144,
        0.8062805533409119,
        0.8328419327735901,
        0.8339008390903473,
        0.8339008390903473,
        0.834255039691925
      ],
      "expected": {
        "calibrated_mae": 0.107541
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:25000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4785708983739217,
        0.4785708983739217,
        0.4785708983739217,
        0.5266409516334534,
        0.5407084226608276,
        0.5599452257156372,
        0.586997389793396,
        0.6134349703788757,
        0.6449673771858215,
        0.6813910603523254,
        0.7116435766220093,
        0.743293821811676,
        0.7578127384185791,
        0.7987275123596191,
        0.8067139983177185,
        0.8097230792045593,
        0.834794819355011,
        0.8359694480895996,
        0.8359694480895996,
        0.8362533450126648
      ],
      "expected": {
        "calibrated_mae": 0.110273
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:25000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4662795166174571,
        0.4662795166174571,
        0.4662795166174571,
        0.5162916779518127,
        0.5307309627532959,
        0.5508790016174316,
        0.5793581008911133,
        0.6073058247566223,
        0.6406906247138977,
        0.6794662475585938,
        0.711402177810669,
        0.744955837726593,
        0.7601213455200195,
        0.8026206493377686,
        0.8109243512153625,
        0.8140709400177002,
        0.8396630883216858,
        0.8407999575138092,
        0.8407999575138092,
        0.8410648703575134
      ],
      "expected": {
        "calibrated_mae": 0.104378
      }
    },
    {
      "context_key": "normal:triplet-p1:survival:25000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46550416946411133,
        0.46550416946411133,
        0.46550416946411133,
        0.5133990049362183,
        0.5274003744125366,
        0.5471469759941101,
        0.5747042298316956,
        0.6022310853004456,
        0.634769082069397,
        0.6727677583694458,
        0.7040647864341736,
        0.7372121214866638,
        0.7525773644447327,
        0.7957881093025208,
        0.8041689395904541,
        0.8071752786636353,
        0.8338153958320618,
        0.8349404036998749,
        0.8349404036998749,
        0.8353428244590759
      ],
      "expected": {
        "calibrated_mae": 0.106636
      }
    },
    {
      "context_key": "normal:budget-p2:random:500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4301970700422923,
        0.4301970700422923,
        0.4301970700422923,
        0.5010182857513428,
        0.5204359889030457,
        0.549000084400177,
        0.5899030566215515,
        0.6258887648582458,
        0.6688916683197021,
        0.7141459584236145,
        0.7488226890563965,
        0.7827448844909668,
        0.7968518733978271,
        0.8349669575691223,
        0.8431645035743713,
        0.8454563617706299,
        0.8670168519020081,
        0.8683919310569763,
        0.8683919310569763,
        0.8689895272254944
      ],
      "expected": {
        "calibrated_mae": 0.082807
      }
    },
    {
      "context_key": "normal:budget-p2:random:500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.44292956590652466,
        0.44292956590652466,
        0.44292956590652466,
        0.5136085748672485,
        0.5328769683837891,
        0.5603153109550476,
        0.5999377965927124,
        0.6342210173606873,
        0.6757139563560486,
        0.7190868258476257,
        0.75319904088974,
        0.7862811088562012,
        0.7998631000518799,
        0.8372416496276855,
        0.8453165888786316,
        0.8478018045425415,
        0.8683071136474609,
        0.8698618113994598,
        0.8698618113994598,
        0.8704239130020142
      ],
      "expected": {
        "calibrated_mae": 0.086379
      }
    },
    {
      "context_key": "normal:budget-p2:random:500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4222243130207062,
        0.4222243130207062,
        0.4222243130207062,
        0.49663299322128296,
        0.5171780586242676,
        0.5468098521232605,
        0.5900018811225891,
        0.6270748376846313,
        0.6710203289985657,
        0.7165598273277283,
        0.7515231370925903,
        0.7852663993835449,
        0.7990334630012512,
        0.8366749286651611,
        0.8449753522872925,
        0.8474608063697815,
        0.868553876876831,
        0.8701475560665131,
        0.8701475560665131,
        0.8706488013267517
      ],
      "expected": {
        "calibrated_mae": 0.080188
      }
    },
    {
      "context_key": "normal:budget-p2:random:500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4294222593307495,
        0.4294222593307495,
        0.4294222593307495,
        0.4997900426387787,
        0.5191249251365662,
        0.5474535226821899,
        0.5884110331535339,
        0.624480128288269,
        0.6675882935523987,
        0.7130594849586487,
        0.7479488849639893,
        0.7822763919830322,
        0.7964109778404236,
        0.8349866271018982,
        0.843317985534668,
        0.845781147480011,
        0.867249608039856,
        0.8687650561332703,
        0.8687650561332703,
        0.8694695234298706
      ],
      "expected": {
        "calibrated_mae": 0.082322
      }
    },
    {
      "context_key": "normal:budget-p2:random:1500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4636194209257762,
        0.4636194209257762,
        0.4636194209257762,
        0.5128080248832703,
        0.5257636904716492,
        0.543980062007904,
        0.56961989402771,
        0.5927350521087646,
        0.6207482218742371,
        0.6514537930488586,
        0.676632821559906,
        0.7045010328292847,
        0.7158629298210144,
        0.7529292106628418,
        0.7607642412185669,
        0.7630135416984558,
        0.788053572177887,
        0.7893711626529694,
        0.7893711626529694,
        0.7897650003433228
      ],
      "expected": {
        "calibrated_mae": 0.126207
      }
    },
    {
      "context_key": "normal:budget-p2:random:1500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46987754106521606,
        0.46987754106521606,
        0.46987754106521606,
        0.5192767381668091,
        0.5323769450187683,
        0.5503009557723999,
        0.5759459733963013,
        0.5986328721046448,
        0.6264327764511108,
        0.656621515750885,
        0.6817864179611206,
        0.7093451023101807,
        0.7204618453979492,
        0.7569225430488586,
        0.764802098274231,
        0.7672046422958374,
        0.7912728786468506,
        0.7927567660808563,
        0.7927567660808563,
        0.7931128144264221
      ],
      "expected": {
        "calibrated_mae": 0.126746
      }
    },
    {
      "context_key": "normal:budget-p2:random:1500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4575238724549611,
        0.4575238724549611,
        0.4575238724549611,
        0.5101200342178345,
        0.5237932205200195,
        0.5426208972930908,
        0.5696181654930115,
        0.5933145880699158,
        0.6220090389251709,
        0.6531198024749756,
        0.6787043809890747,
        0.7068604230880737,
        0.7180810570716858,
        0.7551824450492859,
        0.7632496953010559,
        0.7657283544540405,
        0.7905310988426208,
        0.7920869290828705,
        0.7920869290828705,
        0.7924259901046753
      ],
      "expected": {
        "calibrated_mae": 0.123767
      }
    },
    {
      "context_key": "normal:budget-p2:random:1500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4598205586274465,
        0.4598205586274465,
        0.4598205586274465,
        0.508821964263916,
        0.5218009352684021,
        0.5400123596191406,
        0.5659295320510864,
        0.5893065333366394,
        0.6176548600196838,
        0.6487705111503601,
        0.6743288040161133,
        0.70271235704422,
        0.714273989200592,
        0.7520434856414795,
        0.7601112127304077,
        0.762496292591095,
        0.7877956628799438,
        0.7892260551452637,
        0.7892260551452637,
        0.7897003889083862
      ],
      "expected": {
        "calibrated_mae": 0.125083
      }
    },
    {
      "context_key": "normal:budget-p2:random:4000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.476659615834554,
        0.476659615834554,
        0.476659615834554,
        0.5162672996520996,
        0.5269017219543457,
        0.541930615901947,
        0.5631392598152161,
        0.5831281542778015,
        0.6068633794784546,
        0.6342043280601501,
        0.6568242907524109,
        0.6825301647186279,
        0.6933475136756897,
        0.7290176749229431,
        0.7362684607505798,
        0.7382310628890991,
        0.763423502445221,
        0.7643649876117706,
        0.7643649876117706,
        0.7645270824432373
      ],
      "expected": {
        "calibrated_mae": 0.139523
      }
    },
    {
      "context_key": "normal:budget-p2:random:4000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48064659039179486,
        0.48064659039179486,
        0.48064659039179486,
        0.52076655626297,
        0.5316486358642578,
        0.5466181635856628,
        0.5681033730506897,
        0.5879932641983032,
        0.6118724942207336,
        0.639054536819458,
        0.6618529558181763,
        0.6875511407852173,
        0.698275089263916,
        0.7336629033088684,
        0.7410298585891724,
        0.7431294918060303,
        0.7676408290863037,
        0.7687442302703857,
        0.7687442302703857,
        0.7688698172569275
      ],
      "expected": {
        "calibrated_mae": 0.138987
      }
    },
    {
      "context_key": "normal:budget-p2:random:4000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47251683473587036,
        0.47251683473587036,
        0.47251683473587036,
        0.5143189430236816,
        0.5254793763160706,
        0.5409488081932068,
        0.5632019639015198,
        0.5837887525558472,
        0.6084168553352356,
        0.6365132331848145,
        0.659909725189209,
        0.6863980889320374,
        0.69728022813797,
        0.7335087060928345,
        0.7410258650779724,
        0.7431849241256714,
        0.7683261632919312,
        0.7694379985332489,
        0.7694379985332489,
        0.7695589661598206
      ],
      "expected": {
        "calibrated_mae": 0.136424
      }
    },
    {
      "context_key": "normal:budget-p2:random:4000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4734564423561096,
        0.4734564423561096,
        0.4734564423561096,
        0.5126380324363708,
        0.5232688784599304,
        0.5382744073867798,
        0.5595738887786865,
        0.5797415971755981,
        0.6037805080413818,
        0.6314211487770081,
        0.6544139385223389,
        0.6805985569953918,
        0.6916831135749817,
        0.7281880378723145,
        0.7356457710266113,
        0.7376706004142761,
        0.7633506655693054,
        0.7643701434135437,
        0.7643701434135437,
        0.7645576596260071
      ],
      "expected": {
        "calibrated_mae": 0.138537
      }
    },
    {
      "context_key": "normal:budget-p2:random:10000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4773624837398529,
        0.4773624837398529,
        0.4773624837398529,
        0.5217961668968201,
        0.5339018106460571,
        0.551179051399231,
        0.5753142833709717,
        0.5979524254798889,
        0.6251829862594604,
        0.6559953689575195,
        0.6814001798629761,
        0.709037721157074,
        0.7210429906845093,
        0.7577344179153442,
        0.7650160789489746,
        0.7673518657684326,
        0.7919636964797974,
        0.7930042445659637,
        0.7930042445659637,
        0.7932813763618469
      ],
      "expected": {
        "calibrated_mae": 0.127897
      }
    },
    {
      "context_key": "normal:budget-p2:random:10000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48463185628255206,
        0.48463185628255206,
        0.48463185628255206,
        0.5288636088371277,
        0.5410537719726562,
        0.5579188466072083,
        0.5818120837211609,
        0.6038487553596497,
        0.6306230425834656,
        0.6606106758117676,
        0.6857253909111023,
        0.7128174304962158,
        0.7244706153869629,
        0.7604303359985352,
        0.7677189111709595,
        0.770176112651825,
        0.7939567565917969,
        0.7951682507991791,
        0.7951682507991791,
        0.7953993082046509
      ],
      "expected": {
        "calibrated_mae": 0.129286
      }
    },
    {
      "context_key": "normal:budget-p2:random:10000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4723382294178009,
        0.4723382294178009,
        0.4723382294178009,
        0.519225001335144,
        0.5319262146949768,
        0.5497545003890991,
        0.5751805901527405,
        0.5985835194587708,
        0.6268050670623779,
        0.6584799289703369,
        0.6846773028373718,
        0.7129320502281189,
        0.7249230742454529,
        0.761742353439331,
        0.7691870927810669,
        0.7717158794403076,
        0.7959682941436768,
        0.7971829771995544,
        0.7971829771995544,
        0.7973945140838623
      ],
      "expected": {
        "calibrated_mae": 0.124823
      }
    },
    {
      "context_key": "normal:budget-p2:random:10000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.474006990591685,
        0.474006990591685,
        0.474006990591685,
        0.5180168747901917,
        0.5301147699356079,
        0.5472909212112427,
        0.5714572668075562,
        0.594184935092926,
        0.6215516924858093,
        0.6525307893753052,
        0.6781809329986572,
        0.7062357664108276,
        0.7184110283851624,
        0.7558905482292175,
        0.7633903622627258,
        0.7658324241638184,
        0.7908614873886108,
        0.7920023798942566,
        0.7920023798942566,
        0.7923369407653809
      ],
      "expected": {
        "calibrated_mae": 0.127316
      }
    },
    {
      "context_key": "normal:budget-p2:random:25000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4650339186191559,
        0.4650339186191559,
        0.4650339186191559,
        0.5105802416801453,
        0.52327561378479,
        0.5415654182434082,
        0.5670615434646606,
        0.5920388698577881,
        0.6218189001083374,
        0.6567080020904541,
        0.6856634020805359,
        0.7166070342063904,
        0.7307614684104919,
        0.7721522450447083,
        0.7803662419319153,
        0.7829393744468689,
        0.8098781108856201,
        0.810916006565094,
        0.810916006565094,
        0.8110823631286621
      ],
      "expected": {
        "calibrated_mae": 0.11664
      }
    },
    {
      "context_key": "normal:budget-p2:random:25000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47429221868515015,
        0.47429221868515015,
        0.47429221868515015,
        0.5199971199035645,
        0.5329316258430481,
        0.5509375929832458,
        0.5763243436813354,
        0.6007760763168335,
        0.630144476890564,
        0.6640843152999878,
        0.6925762295722961,
        0.7226449251174927,
        0.7362872362136841,
        0.7762950658798218,
        0.7843376994132996,
        0.7869715690612793,
        0.812675952911377,
        0.8138520419597626,
        0.8138520419597626,
        0.8139657974243164
      ],
      "expected": {
        "calibrated_mae": 0.11829
      }
    },
    {
      "context_key": "normal:budget-p2:random:25000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46264785528182983,
        0.46264785528182983,
        0.46264785528182983,
        0.5100259184837341,
        0.5232685208320618,
        0.54198157787323,
        0.5685392022132874,
        0.594207227230072,
        0.6250638365745544,
        0.6609380841255188,
        0.6908453106880188,
        0.7225778102874756,
        0.7367825508117676,
        0.7783625721931458,
        0.7867235541343689,
        0.7894811034202576,
        0.8158986568450928,
        0.8170551657676697,
        0.8170551657676697,
        0.8171434998512268
      ],
      "expected": {
        "calibrated_mae": 0.113376
      }
    },
    {
      "context_key": "normal:budget-p2:random:25000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4646870195865631,
        0.4646870195865631,
        0.4646870195865631,
        0.5098194479942322,
        0.5225942730903625,
        0.5408446788787842,
        0.5663483142852783,
        0.5914375185966492,
        0.6212972402572632,
        0.6561899781227112,
        0.6851841807365417,
        0.7161790728569031,
        0.730394721031189,
        0.7720826864242554,
        0.7803817391395569,
        0.7829450368881226,
        0.8100521564483643,
        0.811152994632721,
        0.811152994632721,
        0.8113536238670349
      ],
      "expected": {
        "calibrated_mae": 0.116434
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4245656232039134,
        0.4245656232039134,
        0.4245656232039134,
        0.4938257336616516,
        0.5141216516494751,
        0.5452504754066467,
        0.5919769406318665,
        0.6337292790412903,
        0.6838902831077576,
        0.7360793948173523,
        0.7746914029121399,
        0.8101280927658081,
        0.8244515061378479,
        0.8607243895530701,
        0.8682004809379578,
        0.870434582233429,
        0.8892509341239929,
        0.8905736804008484,
        0.8905736804008484,
        0.8912952542304993
      ],
      "expected": {
        "calibrated_mae": 0.070246
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4362668494383494,
        0.4362668494383494,
        0.4362668494383494,
        0.5067503452301025,
        0.5270884037017822,
        0.557119607925415,
        0.6022750735282898,
        0.6418251395225525,
        0.6898400187492371,
        0.7395617365837097,
        0.7774565815925598,
        0.8121001720428467,
        0.825989842414856,
        0.8620026111602783,
        0.8694228529930115,
        0.8718969821929932,
        0.8900173902511597,
        0.891528993844986,
        0.891528993844986,
        0.8922310471534729
      ],
      "expected": {
        "calibrated_mae": 0.074587
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4112016161282857,
        0.4112016161282857,
        0.4112016161282857,
        0.482924222946167,
        0.5046378970146179,
        0.5377053618431091,
        0.5888835787773132,
        0.6337418556213379,
        0.6867990493774414,
        0.740573525428772,
        0.7798396944999695,
        0.8149183988571167,
        0.8286876678466797,
        0.8637969493865967,
        0.8712700605392456,
        0.8736709356307983,
        0.8917456865310669,
        0.893277108669281,
        0.893277108669281,
        0.8939418196678162
      ],
      "expected": {
        "calibrated_mae": 0.065355
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4205486575762431,
        0.4205486575762431,
        0.4205486575762431,
        0.4905257225036621,
        0.5110796689987183,
        0.542729914188385,
        0.5908008217811584,
        0.6337143778800964,
        0.6850650906562805,
        0.7382394671440125,
        0.7772648930549622,
        0.8129308223724365,
        0.8271125555038452,
        0.8632632493972778,
        0.8707678914070129,
        0.8732006549835205,
        0.8915241956710815,
        0.8929999768733978,
        0.8929999768733978,
        0.8938597440719604
      ],
      "expected": {
        "calibrated_mae": 0.068027
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:1500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4681554933389028,
        0.4681554933389028,
        0.4681554933389028,
        0.5196490287780762,
        0.5335594415664673,
        0.5535570383071899,
        0.5821493864059448,
        0.6077069044113159,
        0.6388325095176697,
        0.6728091239929199,
        0.700502336025238,
        0.7303358316421509,
        0.7423251271247864,
        0.7803728580474854,
        0.7883145213127136,
        0.7909332513809204,
        0.8150191307067871,
        0.8165075480937958,
        0.8165075480937958,
        0.8171561360359192
      ],
      "expected": {
        "calibrated_mae": 0.115925
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:1500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4736931522687276,
        0.4736931522687276,
        0.4736931522687276,
        0.5257298350334167,
        0.53980553150177,
        0.559501051902771,
        0.5880417823791504,
        0.6130766868591309,
        0.6438765525817871,
        0.6772148013114929,
        0.7048189640045166,
        0.7342662215232849,
        0.7459933161735535,
        0.7835269570350647,
        0.7915143370628357,
        0.7943092584609985,
        0.8175479769706726,
        0.8192203044891357,
        0.8192203044891357,
        0.8198350667953491
      ],
      "expected": {
        "calibrated_mae": 0.11665
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:1500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4574992855389913,
        0.4574992855389913,
        0.4574992855389913,
        0.5130842328071594,
        0.5280372500419617,
        0.5492696762084961,
        0.5802933573722839,
        0.6072533130645752,
        0.6399230360984802,
        0.6750359535217285,
        0.7035145163536072,
        0.7338185906410217,
        0.7456264495849609,
        0.7835972905158997,
        0.7917923331260681,
        0.7946764826774597,
        0.8183863162994385,
        0.8201562464237213,
        0.8201562464237213,
        0.8207933306694031
      ],
      "expected": {
        "calibrated_mae": 0.111608
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:1500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4622572660446167,
        0.4622572660446167,
        0.4622572660446167,
        0.5146009922027588,
        0.5287372469902039,
        0.5490915775299072,
        0.5785329341888428,
        0.6047665476799011,
        0.6366673707962036,
        0.6714744567871094,
        0.6997891664505005,
        0.7303375005722046,
        0.742537260055542,
        0.7814028263092041,
        0.7896196246147156,
        0.7924721240997314,
        0.8167094588279724,
        0.818379133939743,
        0.818379133939743,
        0.8191737532615662
      ],
      "expected": {
        "calibrated_mae": 0.113412
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:4000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4822067320346832,
        0.4822067320346832,
        0.4822067320346832,
        0.523179292678833,
        0.534303605556488,
        0.5502861142158508,
        0.5732116103172302,
        0.5945882797241211,
        0.6201961636543274,
        0.6497087478637695,
        0.6742299199104309,
        0.7017757892608643,
        0.7132741808891296,
        0.7505665421485901,
        0.7581325173377991,
        0.7605461478233337,
        0.7856180667877197,
        0.7867738604545593,
        0.7867738604545593,
        0.7871599793434143
      ],
      "expected": {
        "calibrated_mae": 0.131859
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:4000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4855177899201711,
        0.4855177899201711,
        0.4855177899201711,
        0.5272460579872131,
        0.5386515855789185,
        0.5546091198921204,
        0.5778495073318481,
        0.5991345047950745,
        0.624896228313446,
        0.6542546153068542,
        0.6789528131484985,
        0.7064948678016663,
        0.7179028987884521,
        0.7549858093261719,
        0.7626621127128601,
        0.7652238011360168,
        0.7896454334259033,
        0.7909753024578094,
        0.7909753024578094,
        0.7913262844085693
      ],
      "expected": {
        "calibrated_mae": 0.131245
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:4000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47505932052930194,
        0.47505932052930194,
        0.47505932052930194,
        0.5187870264053345,
        0.5306063890457153,
        0.5473464131355286,
        0.5718793869018555,
        0.5942913293838501,
        0.6213230490684509,
        0.6521177291870117,
        0.6777753829956055,
        0.7063971161842346,
        0.7180268168449402,
        0.7560227513313293,
        0.7638994455337524,
        0.7665531635284424,
        0.7915229797363281,
        0.7928807437419891,
        0.7928807437419891,
        0.7932533621788025
      ],
      "expected": {
        "calibrated_mae": 0.127372
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:4000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4775848885377248,
        0.4775848885377248,
        0.4775848885377248,
        0.5187869071960449,
        0.5300185084342957,
        0.5461583733558655,
        0.569462239742279,
        0.5912342071533203,
        0.6173943281173706,
        0.6474749445915222,
        0.6725726127624512,
        0.7008454203605652,
        0.7126957774162292,
        0.7511143684387207,
        0.7589518427848816,
        0.7615110278129578,
        0.7871006727218628,
        0.7883856296539307,
        0.7883856296539307,
        0.7888386249542236
      ],
      "expected": {
        "calibrated_mae": 0.129864
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:10000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4827052354812622,
        0.4827052354812622,
        0.4827052354812622,
        0.5283627510070801,
        0.5410099625587463,
        0.5593653917312622,
        0.5854617953300476,
        0.6098254323005676,
        0.6394366025924683,
        0.6730334162712097,
        0.7008274793624878,
        0.7305187582969666,
        0.7433682084083557,
        0.7813738584518433,
        0.7887720465660095,
        0.7914724946022034,
        0.8154051899909973,
        0.8165802657604218,
        0.8165802657604218,
        0.8170561790466309
      ],
      "expected": {
        "calibrated_mae": 0.119297
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:10000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4895242253939311,
        0.4895242253939311,
        0.4895242253939311,
        0.5353412628173828,
        0.5481196641921997,
        0.5660737752914429,
        0.5918957591056824,
        0.6155744791030884,
        0.6446105241775513,
        0.677214503288269,
        0.7045861482620239,
        0.7336273789405823,
        0.7460870146751404,
        0.7834163904190063,
        0.790827214717865,
        0.7936638593673706,
        0.8168919086456299,
        0.8182571232318878,
        0.8182571232318878,
        0.8186904788017273
      ],
      "expected": {
        "calibrated_mae": 0.120901
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:10000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47418983777364093,
        0.47418983777364093,
        0.47418983777364093,
        0.5227500796318054,
        0.5361694693565369,
        0.5554211735725403,
        0.5834988951683044,
        0.6091955304145813,
        0.6405279040336609,
        0.6757246851921082,
        0.7048074007034302,
        0.7354745268821716,
        0.7483764290809631,
        0.7865169644355774,
        0.7940829396247864,
        0.7969964742660522,
        0.8203895092010498,
        0.8217514455318451,
        0.8217514455318451,
        0.8221886157989502
      ],
      "expected": {
        "calibrated_mae": 0.114571
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:10000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47750653823216754,
        0.47750653823216754,
        0.47750653823216754,
        0.5235868096351624,
        0.536383867263794,
        0.5549041628837585,
        0.5814367532730103,
        0.6061992049217224,
        0.6363013386726379,
        0.6704235076904297,
        0.6987162828445435,
        0.7290763258934021,
        0.7421724796295166,
        0.7811770439147949,
        0.7888373732566833,
        0.791727602481842,
        0.8160353302955627,
        0.8173608183860779,
        0.8173608183860779,
        0.8179383277893066
      ],
      "expected": {
        "calibrated_mae": 0.117493
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:25000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47058770060539246,
        0.47058770060539246,
        0.47058770060539246,
        0.5182693004608154,
        0.531583845615387,
        0.5510178804397583,
        0.578432023525238,
        0.604997456073761,
        0.6368905901908875,
        0.674243688583374,
        0.7052106857299805,
        0.7378645539283752,
        0.7526837587356567,
        0.7950166463851929,
        0.8032453060150146,
        0.8061555027961731,
        0.8320791721343994,
        0.8332174122333527,
        0.8332174122333527,
        0.8336143493652344
      ],
      "expected": {
        "calibrated_mae": 0.108788
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:25000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4793185492356618,
        0.4793185492356618,
        0.4793185492356618,
        0.5273247361183167,
        0.5408955216407776,
        0.5600141882896423,
        0.5872522592544556,
        0.6132089495658875,
        0.6445868611335754,
        0.6808361411094666,
        0.7112298607826233,
        0.7429167032241821,
        0.7572053670883179,
        0.7981919050216675,
        0.8062406778335571,
        0.8092045187950134,
        0.8340309262275696,
        0.8353099226951599,
        0.8353099226951599,
        0.835645318031311
      ],
      "expected": {
        "calibrated_mae": 0.110724
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:25000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46525537967681885,
        0.46525537967681885,
        0.46525537967681885,
        0.515313982963562,
        0.5293259024620056,
        0.5494402050971985,
        0.5783740878105164,
        0.6059909462928772,
        0.6394462585449219,
        0.6782602667808533,
        0.7105140089988708,
        0.7442310452461243,
        0.759182333946228,
        0.8017905950546265,
        0.8101710081100464,
        0.8132839798927307,
        0.8385982513427734,
        0.8398532867431641,
        0.8398532867431641,
        0.8401901721954346
      ],
      "expected": {
        "calibrated_mae": 0.104354
      }
    },
    {
      "context_key": "normal:budget-p2:clear-greedy:25000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4689834912618001,
        0.4689834912618001,
        0.4689834912618001,
        0.5169416666030884,
        0.5304668545722961,
        0.5500607490539551,
        0.577762246131897,
        0.6046813130378723,
        0.6369200944900513,
        0.6745541095733643,
        0.7057740092277527,
        0.7386752367019653,
        0.7536502480506897,
        0.796459972858429,
        0.8048049211502075,
        0.8077658414840698,
        0.8338201642036438,
        0.8350453674793243,
        0.8350453674793243,
        0.8355041742324829
      ],
      "expected": {
        "calibrated_mae": 0.107602
      }
    },
    {
      "context_key": "normal:budget-p2:survival:500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42843661705652875,
        0.42843661705652875,
        0.42843661705652875,
        0.4970920979976654,
        0.5170973539352417,
        0.5475274920463562,
        0.5928296446800232,
        0.6334999203681946,
        0.682458221912384,
        0.733178973197937,
        0.7711915969848633,
        0.8065288066864014,
        0.8209505081176758,
        0.8577978610992432,
        0.8654674291610718,
        0.8677244186401367,
        0.8871068954467773,
        0.8884362876415253,
        0.8884362876415253,
        0.8890936970710754
      ],
      "expected": {
        "calibrated_mae": 0.072446
      }
    },
    {
      "context_key": "normal:budget-p2:survival:500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4404410819212596,
        0.4404410819212596,
        0.4404410819212596,
        0.5102453827857971,
        0.5303126573562622,
        0.5597188472747803,
        0.6036560535430908,
        0.6423002481460571,
        0.6892658472061157,
        0.7376540899276733,
        0.7749014496803284,
        0.8093155026435852,
        0.8232257962226868,
        0.8595837950706482,
        0.8671638369560242,
        0.8696536421775818,
        0.888203501701355,
        0.8897224962711334,
        0.8897224962711334,
        0.890364944934845
      ],
      "expected": {
        "calibrated_mae": 0.076764
      }
    },
    {
      "context_key": "normal:budget-p2:survival:500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4171890715758006,
        0.4171890715758006,
        0.4171890715758006,
        0.48861923813819885,
        0.5099082589149475,
        0.5419455766677856,
        0.5909348726272583,
        0.634011447429657,
        0.6852478981018066,
        0.7371922731399536,
        0.7757735252380371,
        0.810781717300415,
        0.8246922492980957,
        0.8604871034622192,
        0.868166446685791,
        0.8705863356590271,
        0.8892261385917664,
        0.8907549977302551,
        0.8907549977302551,
        0.8913424015045166
      ],
      "expected": {
        "calibrated_mae": 0.068476
      }
    },
    {
      "context_key": "normal:budget-p2:survival:500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4260002275307973,
        0.4260002275307973,
        0.4260002275307973,
        0.4951831102371216,
        0.5153228044509888,
        0.5459729433059692,
        0.5920528173446655,
        0.633405864238739,
        0.6831191182136536,
        0.7345583438873291,
        0.7729544639587402,
        0.8086170554161072,
        0.8229781985282898,
        0.8599416613578796,
        0.8676856756210327,
        0.8701434135437012,
        0.8891306519508362,
        0.8906100988388062,
        0.8906100988388062,
        0.8913961052894592
      ],
      "expected": {
        "calibrated_mae": 0.070811
      }
    },
    {
      "context_key": "normal:budget-p2:survival:1500:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4703769286473592,
        0.4703769286473592,
        0.4703769286473592,
        0.5211710333824158,
        0.5348658561706543,
        0.5544846653938293,
        0.582452654838562,
        0.6076032519340515,
        0.6381797790527344,
        0.6713035702705383,
        0.6983463764190674,
        0.7276583909988403,
        0.7395009994506836,
        0.7771922945976257,
        0.7850827574729919,
        0.7876007556915283,
        0.8118234276771545,
        0.813256710767746,
        0.813256710767746,
        0.8138033747673035
      ],
      "expected": {
        "calibrated_mae": 0.118021
      }
    },
    {
      "context_key": "normal:budget-p2:survival:1500:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47604017456372577,
        0.47604017456372577,
        0.47604017456372577,
        0.5274312496185303,
        0.5413227677345276,
        0.5606765151023865,
        0.5886679887771606,
        0.6133549809455872,
        0.6436495184898376,
        0.6762006878852844,
        0.703184187412262,
        0.7321045994758606,
        0.7436735033988953,
        0.7807865738868713,
        0.7887188792228699,
        0.791412353515625,
        0.8147189021110535,
        0.8163385093212128,
        0.8163385093212128,
        0.8168594837188721
      ],
      "expected": {
        "calibrated_mae": 0.118612
      }
    },
    {
      "context_key": "normal:budget-p2:survival:1500:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46134408315022785,
        0.46134408315022785,
        0.46134408315022785,
        0.5159145593643188,
        0.5305370688438416,
        0.5511765480041504,
        0.581224799156189,
        0.6075209379196167,
        0.6393823623657227,
        0.6734553575515747,
        0.7012006044387817,
        0.7309439778327942,
        0.7426188588142395,
        0.7802501916885376,
        0.7883855104446411,
        0.7911551594734192,
        0.8149986863136292,
        0.8166953921318054,
        0.8166953921318054,
        0.8172170519828796
      ],
      "expected": {
        "calibrated_mae": 0.114276
      }
    },
    {
      "context_key": "normal:budget-p2:survival:1500:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.465462585290273,
        0.465462585290273,
        0.465462585290273,
        0.5167335271835327,
        0.5305684208869934,
        0.5503833889961243,
        0.5789552927017212,
        0.6046140789985657,
        0.63579261302948,
        0.6696183681488037,
        0.6972313523292542,
        0.7272276282310486,
        0.7392998337745667,
        0.7778578996658325,
        0.7860330939292908,
        0.7887621521949768,
        0.8132060766220093,
        0.8148064315319061,
        0.8148064315319061,
        0.8154819011688232
      ],
      "expected": {
        "calibrated_mae": 0.115923
      }
    },
    {
      "context_key": "normal:budget-p2:survival:4000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48402010401089984,
        0.48402010401089984,
        0.48402010401089984,
        0.5242693424224854,
        0.535209059715271,
        0.5508824586868286,
        0.5732593536376953,
        0.594322681427002,
        0.6194664835929871,
        0.6482620239257812,
        0.6721685528755188,
        0.6991599798202515,
        0.7104938626289368,
        0.7473246455192566,
        0.7547929883003235,
        0.7570576667785645,
        0.782192587852478,
        0.783263236284256,
        0.783263236284256,
        0.7835350632667542
      ],
      "expected": {
        "calibrated_mae": 0.133866
      }
    },
    {
      "context_key": "normal:budget-p2:survival:4000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4875541826089223,
        0.4875541826089223,
        0.4875541826089223,
        0.5285942554473877,
        0.5398375988006592,
        0.555508553981781,
        0.5782461166381836,
        0.5992577075958252,
        0.6245890259742737,
        0.6532819271087646,
        0.6773941516876221,
        0.7043855786323547,
        0.7156285047531128,
        0.7522097229957581,
        0.7597911357879639,
        0.7622066140174866,
        0.7866464257240295,
        0.7878938317298889,
        0.7878938317298889,
        0.7881380319595337
      ],
      "expected": {
        "calibrated_mae": 0.133129
      }
    },
    {
      "context_key": "normal:budget-p2:survival:4000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47827811042467755,
        0.47827811042467755,
        0.47827811042467755,
        0.5210461616516113,
        0.5326234698295593,
        0.5489378571510315,
        0.5727218985557556,
        0.594679057598114,
        0.6210765838623047,
        0.6510107517242432,
        0.6759593486785889,
        0.7039463520050049,
        0.7153986096382141,
        0.752884566783905,
        0.7606497406959534,
        0.7631421685218811,
        0.7881599068641663,
        0.789417952299118,
        0.789417952299118,
        0.7896670699119568
      ],
      "expected": {
        "calibrated_mae": 0.129781
      }
    },
    {
      "context_key": "normal:budget-p2:survival:4000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4800054430961609,
        0.4800054430961609,
        0.4800054430961609,
        0.5202803015708923,
        0.5312935709953308,
        0.5470557808876038,
        0.5697017908096313,
        0.5910884737968445,
        0.6166929006576538,
        0.6459769010543823,
        0.6703985333442688,
        0.6980517506599426,
        0.7097263932228088,
        0.7476513981819153,
        0.7553895711898804,
        0.7577731609344482,
        0.7834649682044983,
        0.7846527099609375,
        0.7846527099609375,
        0.7849792242050171
      ],
      "expected": {
        "calibrated_mae": 0.132138
      }
    },
    {
      "context_key": "normal:budget-p2:survival:10000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48491020997365314,
        0.48491020997365314,
        0.48491020997365314,
        0.529721200466156,
        0.5421417355537415,
        0.5600809454917908,
        0.5854657292366028,
        0.6093392968177795,
        0.6382927298545837,
        0.6709036827087402,
        0.6979396939277649,
        0.7270265221595764,
        0.7396847605705261,
        0.7773885726928711,
        0.784758985042572,
        0.7873583436012268,
        0.8115167617797852,
        0.8126348257064819,
        0.8126348257064819,
        0.8130059838294983
      ],
      "expected": {
        "calibrated_mae": 0.121714
      }
    },
    {
      "context_key": "normal:budget-p2:survival:10000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4918467203776042,
        0.4918467203776042,
        0.4918467203776042,
        0.5368224382400513,
        0.549396276473999,
        0.566967248916626,
        0.5921515226364136,
        0.6154077649116516,
        0.6438565850257874,
        0.6755768656730652,
        0.7022470235824585,
        0.7306995987892151,
        0.7429660558700562,
        0.7799240946769714,
        0.7872978448867798,
        0.7900297045707703,
        0.8133983612060547,
        0.8147031366825104,
        0.8147031366825104,
        0.815037727355957
      ],
      "expected": {
        "calibrated_mae": 0.123146
      }
    },
    {
      "context_key": "normal:budget-p2:survival:10000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47795210282007855,
        0.47795210282007855,
        0.47795210282007855,
        0.5254567861557007,
        0.5385801196098328,
        0.557271420955658,
        0.5843635201454163,
        0.609352171421051,
        0.6397624015808105,
        0.673730194568634,
        0.7019059658050537,
        0.7318673133850098,
        0.7445635795593262,
        0.7824162244796753,
        0.7899572253227234,
        0.7927674055099487,
        0.8164176344871521,
        0.8177147805690765,
        0.8177147805690765,
        0.8180375099182129
      ],
      "expected": {
        "calibrated_mae": 0.117545
      }
    },
    {
      "context_key": "normal:budget-p2:survival:10000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4804005225499471,
        0.4804005225499471,
        0.4804005225499471,
        0.525402307510376,
        0.5379328727722168,
        0.555951714515686,
        0.5816329717636108,
        0.6058051586151123,
        0.6351275444030762,
        0.6681532859802246,
        0.6956097483634949,
        0.7252944111824036,
        0.7381860017776489,
        0.7768861055374146,
        0.7845250368118286,
        0.7872931957244873,
        0.8118886351585388,
        0.8131458163261414,
        0.8131458163261414,
        0.8136069178581238
      ],
      "expected": {
        "calibrated_mae": 0.120234
      }
    },
    {
      "context_key": "normal:budget-p2:survival:25000:onboarding",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4712815582752228,
        0.4712815582752228,
        0.4712815582752228,
        0.5178199410438538,
        0.5308933854103088,
        0.5499176979064941,
        0.576637327671051,
        0.6028246283531189,
        0.6341949105262756,
        0.6707088351249695,
        0.7010985016822815,
        0.733294665813446,
        0.7480395436286926,
        0.7903928756713867,
        0.7986701726913452,
        0.8014833331108093,
        0.8279302716255188,
        0.829017162322998,
        0.829017162322998,
        0.8292894959449768
      ],
      "expected": {
        "calibrated_mae": 0.110827
      }
    },
    {
      "context_key": "normal:budget-p2:survival:25000:growth",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48043424884478253,
        0.48043424884478253,
        0.48043424884478253,
        0.5274145007133484,
        0.5407859086990356,
        0.559544563293457,
        0.5861777067184448,
        0.6118146777153015,
        0.6427319049835205,
        0.6782270669937134,
        0.7080777883529663,
        0.7392995357513428,
        0.753494143486023,
        0.7943812608718872,
        0.8024603724479675,
        0.8053353428840637,
        0.8305392265319824,
        0.8317686915397644,
        0.8317686915397644,
        0.8319894075393677
      ],
      "expected": {
        "calibrated_mae": 0.112589
      }
    },
    {
      "context_key": "normal:budget-p2:survival:25000:mature",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4673272172609965,
        0.4673272172609965,
        0.4673272172609965,
        0.5161039233207703,
        0.5298414826393127,
        0.5494647026062012,
        0.5775560736656189,
        0.6046758890151978,
        0.6374490261077881,
        0.6752672791481018,
        0.7068268060684204,
        0.7399688959121704,
        0.7548053860664368,
        0.7973425984382629,
        0.8057589530944824,
        0.8087725043296814,
        0.8345715999603271,
        0.8357697427272797,
        0.8357697427272797,
        0.8359754085540771
      ],
      "expected": {
        "calibrated_mae": 0.10678
      }
    },
    {
      "context_key": "normal:budget-p2:survival:25000:plateau",
      "context": {
        "difficulty": "normal",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47010372082392377,
        0.47010372082392377,
        0.47010372082392377,
        0.5167661309242249,
        0.530034065246582,
        0.5491744875907898,
        0.5761252641677856,
        0.6026232838630676,
        0.6342825889587402,
        0.6710320115089417,
        0.7016260027885437,
        0.7340139746665955,
        0.7488950490951538,
        0.7916907072067261,
        0.8000856637954712,
        0.8029342889785767,
        0.8295323848724365,
        0.8307012319564819,
        0.8307012319564819,
        0.8310289978981018
      ],
      "expected": {
        "calibrated_mae": 0.109822
      }
    },
    {
      "context_key": "hard:triplet-p1:random:500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.437255064646403,
        0.437255064646403,
        0.437255064646403,
        0.5064729452133179,
        0.5247011780738831,
        0.550748348236084,
        0.5876434445381165,
        0.6215564608573914,
        0.6632903814315796,
        0.7093433737754822,
        0.7451611757278442,
        0.7818111777305603,
        0.7970089912414551,
        0.8362450003623962,
        0.8441818356513977,
        0.8471935391426086,
        0.8685572147369385,
        0.870088666677475,
        0.870088666677475,
        0.8707345724105835
      ],
      "expected": {
        "calibrated_mae": 0.083756
      }
    },
    {
      "context_key": "hard:triplet-p1:random:500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4493661920229594,
        0.4493661920229594,
        0.4493661920229594,
        0.5179992914199829,
        0.5365141034126282,
        0.5621358752250671,
        0.599119246006012,
        0.6323375105857849,
        0.6731683015823364,
        0.717199981212616,
        0.7517913579940796,
        0.7864736318588257,
        0.8007086515426636,
        0.8382716774940491,
        0.84596186876297,
        0.8489887118339539,
        0.8690873980522156,
        0.8707244992256165,
        0.8707244992256165,
        0.8712812662124634
      ],
      "expected": {
        "calibrated_mae": 0.087376
      }
    },
    {
      "context_key": "hard:triplet-p1:random:500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.44141045212745667,
        0.44141045212745667,
        0.44141045212745667,
        0.5103169083595276,
        0.528701663017273,
        0.554272472858429,
        0.5913002490997314,
        0.6248892545700073,
        0.6661620736122131,
        0.7112329602241516,
        0.7464489340782166,
        0.7821155786514282,
        0.796761691570282,
        0.8351608514785767,
        0.8430898785591125,
        0.8461079597473145,
        0.8670067191123962,
        0.86862713098526,
        0.86862713098526,
        0.869083821773529
      ],
      "expected": {
        "calibrated_mae": 0.085748
      }
    },
    {
      "context_key": "hard:triplet-p1:random:500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4386129875977834,
        0.4386129875977834,
        0.4386129875977834,
        0.506320059299469,
        0.5245010852813721,
        0.5502548813819885,
        0.5871015787124634,
        0.6209803223609924,
        0.662388801574707,
        0.707838237285614,
        0.7432177066802979,
        0.7795541882514954,
        0.7945702075958252,
        0.8340076804161072,
        0.842038631439209,
        0.8450884222984314,
        0.8665115237236023,
        0.8681081235408783,
        0.8681081235408783,
        0.8687999248504639
      ],
      "expected": {
        "calibrated_mae": 0.084945
      }
    },
    {
      "context_key": "hard:triplet-p1:random:1500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46457532048225403,
        0.46457532048225403,
        0.46457532048225403,
        0.5129396915435791,
        0.5256263017654419,
        0.5430506467819214,
        0.5679550766944885,
        0.5908429026603699,
        0.6186203956604004,
        0.6497246026992798,
        0.6750030517578125,
        0.7037518620491028,
        0.7154716849327087,
        0.7526679039001465,
        0.7602880597114563,
        0.7630147933959961,
        0.7880091667175293,
        0.7894838750362396,
        0.7894838750362396,
        0.7899593114852905
      ],
      "expected": {
        "calibrated_mae": 0.126263
      }
    },
    {
      "context_key": "hard:triplet-p1:random:1500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47036708394686383,
        0.47036708394686383,
        0.47036708394686383,
        0.5190756916999817,
        0.5321164727210999,
        0.5494869351387024,
        0.5747940540313721,
        0.5975598692893982,
        0.6253246665000916,
        0.6559573411941528,
        0.6811426281929016,
        0.7093474268913269,
        0.7207339406013489,
        0.7570444941520691,
        0.7646563053131104,
        0.7674410939216614,
        0.7912850379943848,
        0.7928617000579834,
        0.7928617000579834,
        0.7932602167129517
      ],
      "expected": {
        "calibrated_mae": 0.126611
      }
    },
    {
      "context_key": "hard:triplet-p1:random:1500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4667415718237559,
        0.4667415718237559,
        0.4667415718237559,
        0.5159322023391724,
        0.5288907885551453,
        0.5462294816970825,
        0.5715280175209045,
        0.5943951606750488,
        0.6221930384635925,
        0.6530910134315491,
        0.6782938838005066,
        0.7067819833755493,
        0.7181950807571411,
        0.7547506093978882,
        0.7624014616012573,
        0.7651634216308594,
        0.7895027995109558,
        0.7910619974136353,
        0.7910619974136353,
        0.7914000153541565
      ],
      "expected": {
        "calibrated_mae": 0.126352
      }
    },
    {
      "context_key": "hard:triplet-p1:random:1500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.461637407541275,
        0.461637407541275,
        0.461637407541275,
        0.5092761516571045,
        0.5220067501068115,
        0.5393747687339783,
        0.5644124150276184,
        0.5874823927879333,
        0.6154048442840576,
        0.6466057896614075,
        0.6720649003982544,
        0.701043963432312,
        0.7128704190254211,
        0.7505186200141907,
        0.7582913637161255,
        0.761049747467041,
        0.7862151861190796,
        0.7877030968666077,
        0.7877030968666077,
        0.7882137298583984
      ],
      "expected": {
        "calibrated_mae": 0.125997
      }
    },
    {
      "context_key": "hard:triplet-p1:random:4000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4746038019657135,
        0.4746038019657135,
        0.4746038019657135,
        0.5146880745887756,
        0.5254780650138855,
        0.5404620170593262,
        0.5617376565933228,
        0.5819671154022217,
        0.6058056354522705,
        0.6336037516593933,
        0.6563798189163208,
        0.6828317642211914,
        0.6938900947570801,
        0.7299317717552185,
        0.7370897531509399,
        0.7394365072250366,
        0.7647384405136108,
        0.7657596468925476,
        0.7657596468925476,
        0.7660346031188965
      ],
      "expected": {
        "calibrated_mae": 0.138392
      }
    },
    {
      "context_key": "hard:triplet-p1:random:4000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4786989688873291,
        0.4786989688873291,
        0.4786989688873291,
        0.519282877445221,
        0.5304080247879028,
        0.5453971028327942,
        0.5670831203460693,
        0.5873404741287231,
        0.6114083528518677,
        0.6390712857246399,
        0.6619935035705566,
        0.6882913708686829,
        0.6992091536521912,
        0.7347000241279602,
        0.7419130802154541,
        0.7443195581436157,
        0.7687575221061707,
        0.7698939442634583,
        0.7698939442634583,
        0.7700964212417603
      ],
      "expected": {
        "calibrated_mae": 0.137912
      }
    },
    {
      "context_key": "hard:triplet-p1:random:4000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47690605123837787,
        0.47690605123837787,
        0.47690605123837787,
        0.517749011516571,
        0.5288254022598267,
        0.5438219904899597,
        0.5654653906822205,
        0.5858141779899597,
        0.6099348068237305,
        0.6378406286239624,
        0.6608729362487793,
        0.6874279975891113,
        0.6983396410942078,
        0.7341306209564209,
        0.7413420081138611,
        0.7437334060668945,
        0.7685579061508179,
        0.7696458697319031,
        0.7696458697319031,
        0.7698134779930115
      ],
      "expected": {
        "calibrated_mae": 0.137517
      }
    },
    {
      "context_key": "hard:triplet-p1:random:4000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47188912828763324,
        0.47188912828763324,
        0.47188912828763324,
        0.5111488699913025,
        0.5219299793243408,
        0.5368247032165527,
        0.5580480098724365,
        0.5783830881118774,
        0.6023937463760376,
        0.6302763223648071,
        0.6533108353614807,
        0.6799858212471008,
        0.691231369972229,
        0.7278419733047485,
        0.7351369261741638,
        0.737448513507843,
        0.7631345987319946,
        0.7641520202159882,
        0.7641520202159882,
        0.7644210457801819
      ],
      "expected": {
        "calibrated_mae": 0.138133
      }
    },
    {
      "context_key": "hard:triplet-p1:random:10000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47547176480293274,
        0.47547176480293274,
        0.47547176480293274,
        0.5199087262153625,
        0.5320924520492554,
        0.5491350293159485,
        0.5729639530181885,
        0.595592737197876,
        0.6226423978805542,
        0.6537395715713501,
        0.6792541742324829,
        0.7075700759887695,
        0.7198956608772278,
        0.7569030523300171,
        0.7639902830123901,
        0.7667604684829712,
        0.7914303541183472,
        0.7925347089767456,
        0.7925347089767456,
        0.7928833365440369
      ],
      "expected": {
        "calibrated_mae": 0.12753
      }
    },
    {
      "context_key": "hard:triplet-p1:random:10000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48285917441050213,
        0.48285917441050213,
        0.48285917441050213,
        0.5270180106163025,
        0.5393792986869812,
        0.5560818314552307,
        0.5798432230949402,
        0.6020305156707764,
        0.6287404894828796,
        0.6590409874916077,
        0.684203565120697,
        0.7117557525634766,
        0.7236462235450745,
        0.7595937848091125,
        0.7666320204734802,
        0.7694248557090759,
        0.7931106686592102,
        0.7943399250507355,
        0.7943399250507355,
        0.7946041226387024
      ],
      "expected": {
        "calibrated_mae": 0.129017
      }
    },
    {
      "context_key": "hard:triplet-p1:random:10000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4781344135602315,
        0.4781344135602315,
        0.4781344135602315,
        0.5233354568481445,
        0.53577721118927,
        0.5527440905570984,
        0.576884925365448,
        0.5995272994041443,
        0.6266631484031677,
        0.6576706767082214,
        0.6832143664360046,
        0.7113718390464783,
        0.723401665687561,
        0.7598324418067932,
        0.7669350504875183,
        0.7697292566299438,
        0.7937876582145691,
        0.7949759066104889,
        0.7949759066104889,
        0.7951933741569519
      ],
      "expected": {
        "calibrated_mae": 0.12738
      }
    },
    {
      "context_key": "hard:triplet-p1:random:10000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4727783302466075,
        0.4727783302466075,
        0.4727783302466075,
        0.5163334012031555,
        0.5284987688064575,
        0.5453464388847351,
        0.5690440535545349,
        0.5916708111763,
        0.6186856031417847,
        0.6496625542640686,
        0.6752343773841858,
        0.7036365270614624,
        0.7160215377807617,
        0.7535400390625,
        0.7607839703559875,
        0.7635571360588074,
        0.7886165976524353,
        0.7897481918334961,
        0.7897481918334961,
        0.790118396282196
      ],
      "expected": {
        "calibrated_mae": 0.12783
      }
    },
    {
      "context_key": "hard:triplet-p1:random:25000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.459131787220637,
        0.459131787220637,
        0.459131787220637,
        0.5052315592765808,
        0.5182878375053406,
        0.5367559790611267,
        0.5624014735221863,
        0.5878813862800598,
        0.6180020570755005,
        0.6536441445350647,
        0.6832658648490906,
        0.7150118947029114,
        0.7296366691589355,
        0.7717483043670654,
        0.7798264026641846,
        0.7828943729400635,
        0.8100513219833374,
        0.8111262023448944,
        0.8111262023448944,
        0.8113737106323242
      ],
      "expected": {
        "calibrated_mae": 0.11478
      }
    },
    {
      "context_key": "hard:triplet-p1:random:25000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46874768535296124,
        0.46874768535296124,
        0.46874768535296124,
        0.5149790048599243,
        0.5283342599868774,
        0.5465085506439209,
        0.5720722675323486,
        0.5970364212989807,
        0.6266925930976868,
        0.6612640619277954,
        0.6902515292167664,
        0.7208629250526428,
        0.7348580956459045,
        0.7751668691635132,
        0.7829867005348206,
        0.7860224843025208,
        0.8117550611495972,
        0.8129314482212067,
        0.8129314482212067,
        0.8130890727043152
      ],
      "expected": {
        "calibrated_mae": 0.116955
      }
    },
    {
      "context_key": "hard:triplet-p1:random:25000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4632026155789693,
        0.4632026155789693,
        0.4632026155789693,
        0.5101566314697266,
        0.5235742926597595,
        0.54204261302948,
        0.5680185556411743,
        0.5935710072517395,
        0.6238663196563721,
        0.6594328880310059,
        0.6890779137611389,
        0.7205575704574585,
        0.7348024845123291,
        0.7759647369384766,
        0.7839601039886475,
        0.7870264649391174,
        0.8132950067520142,
        0.8144161999225616,
        0.8144161999225616,
        0.8145244121551514
      ],
      "expected": {
        "calibrated_mae": 0.114636
      }
    },
    {
      "context_key": "hard:triplet-p1:random:25000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4584165612856547,
        0.4584165612856547,
        0.4584165612856547,
        0.5038262605667114,
        0.5169767737388611,
        0.535351037979126,
        0.5609004497528076,
        0.5864387154579163,
        0.6164920330047607,
        0.6519139409065247,
        0.6813907027244568,
        0.7128912210464478,
        0.7274556756019592,
        0.7695437073707581,
        0.7776396870613098,
        0.7805793285369873,
        0.8078795671463013,
        0.8089531064033508,
        0.8089531064033508,
        0.8092003464698792
      ],
      "expected": {
        "calibrated_mae": 0.115409
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42022591829299927,
        0.42022591829299927,
        0.42022591829299927,
        0.49309042096138,
        0.513489305973053,
        0.5436373353004456,
        0.5866488814353943,
        0.6256945133209229,
        0.6741935014724731,
        0.7276228666305542,
        0.7685233950614929,
        0.8088288307189941,
        0.8247673511505127,
        0.8628893494606018,
        0.8702182173728943,
        0.8732960820198059,
        0.891803503036499,
        0.8933192789554596,
        0.8933192789554596,
        0.8941627740859985
      ],
      "expected": {
        "calibrated_mae": 0.06733
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.43160268664360046,
        0.43160268664360046,
        0.43160268664360046,
        0.5036333203315735,
        0.5240851044654846,
        0.5534350872039795,
        0.5965017676353455,
        0.6352248191833496,
        0.6832922697067261,
        0.734822154045105,
        0.7742453813552856,
        0.8120447993278503,
        0.8269230127334595,
        0.8636212348937988,
        0.8707723617553711,
        0.8739035725593567,
        0.8916134834289551,
        0.8932552337646484,
        0.8932552337646484,
        0.8940223455429077
      ],
      "expected": {
        "calibrated_mae": 0.07174
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4208795626958211,
        0.4208795626958211,
        0.4208795626958211,
        0.4941238462924957,
        0.5147902965545654,
        0.5445671081542969,
        0.5882754921913147,
        0.6277605891227722,
        0.6768730878829956,
        0.7300891876220703,
        0.7705907225608826,
        0.8097313046455383,
        0.8250108361244202,
        0.8621619939804077,
        0.8695226907730103,
        0.8726358413696289,
        0.8907744288444519,
        0.8923996686935425,
        0.8923996686935425,
        0.8930928111076355
      ],
      "expected": {
        "calibrated_mae": 0.068173
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42013058066368103,
        0.42013058066368103,
        0.42013058066368103,
        0.4924640953540802,
        0.5128319263458252,
        0.5428938269615173,
        0.5864135026931763,
        0.6261552572250366,
        0.6752922534942627,
        0.7288588285446167,
        0.7695233821868896,
        0.8093658089637756,
        0.8250094056129456,
        0.8629140257835388,
        0.8702672719955444,
        0.873428463935852,
        0.8917151689529419,
        0.8933272659778595,
        0.8933272659778595,
        0.894241988658905
      ],
      "expected": {
        "calibrated_mae": 0.067242
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:1500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4622482756773631,
        0.4622482756773631,
        0.4622482756773631,
        0.515056312084198,
        0.5290599465370178,
        0.54874187707901,
        0.5768967866897583,
        0.6024215221405029,
        0.6337159276008606,
        0.668707013130188,
        0.697009265422821,
        0.7286558747291565,
        0.7411690950393677,
        0.7797209620475769,
        0.7875527739524841,
        0.7908371090888977,
        0.8149810433387756,
        0.8167209625244141,
        0.8167209625244141,
        0.8175325989723206
      ],
      "expected": {
        "calibrated_mae": 0.114119
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:1500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46716611584027606,
        0.46716611584027606,
        0.46716611584027606,
        0.5202397108078003,
        0.5346040725708008,
        0.5542569756507874,
        0.5830076932907104,
        0.6086016893386841,
        0.6400482058525085,
        0.6745923161506653,
        0.7026774287223816,
        0.7335080504417419,
        0.7456126809120178,
        0.7832431197166443,
        0.7910579442977905,
        0.7943916916847229,
        0.8175246119499207,
        0.8193789720535278,
        0.8193789720535278,
        0.8201087117195129
      ],
      "expected": {
        "calibrated_mae": 0.114507
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:1500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4613994359970093,
        0.4613994359970093,
        0.4613994359970093,
        0.5158125162124634,
        0.5302623510360718,
        0.5501136779785156,
        0.5791784524917603,
        0.6050758957862854,
        0.6368643641471863,
        0.671955406665802,
        0.7002691626548767,
        0.7316256165504456,
        0.7437785267829895,
        0.7816339135169983,
        0.78953617811203,
        0.7928853631019592,
        0.816411018371582,
        0.8182733356952667,
        0.8182733356952667,
        0.8189741373062134
      ],
      "expected": {
        "calibrated_mae": 0.113362
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:1500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4584153691927592,
        0.4584153691927592,
        0.4584153691927592,
        0.5111209750175476,
        0.5252411365509033,
        0.5450413227081299,
        0.5737228989601135,
        0.5997627377510071,
        0.6315863132476807,
        0.6669857501983643,
        0.695601761341095,
        0.7275630235671997,
        0.7401844263076782,
        0.7792312502861023,
        0.7872381210327148,
        0.7906429767608643,
        0.8148852586746216,
        0.8167064487934113,
        0.8167064487934113,
        0.8176026940345764
      ],
      "expected": {
        "calibrated_mae": 0.112886
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:4000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47464736302693683,
        0.47464736302693683,
        0.47464736302693683,
        0.516776442527771,
        0.5282508134841919,
        0.5445694327354431,
        0.5680279731750488,
        0.5900741219520569,
        0.6163299679756165,
        0.6468949913978577,
        0.6719604730606079,
        0.7008832097053528,
        0.7127472758293152,
        0.7507666945457458,
        0.7583391666412354,
        0.7613154649734497,
        0.7866291999816895,
        0.7879443466663361,
        0.7879443466663361,
        0.7885158658027649
      ],
      "expected": {
        "calibrated_mae": 0.129169
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:4000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47791268428166706,
        0.47791268428166706,
        0.47791268428166706,
        0.5207443237304688,
        0.5326051712036133,
        0.5490036606788635,
        0.5730511546134949,
        0.5952705144882202,
        0.6219097375869751,
        0.652449369430542,
        0.6776717901229858,
        0.7063938975334167,
        0.7180919051170349,
        0.7555490732192993,
        0.7631569504737854,
        0.7661762833595276,
        0.7906107902526855,
        0.7920411229133606,
        0.7920411229133606,
        0.7925345301628113
      ],
      "expected": {
        "calibrated_mae": 0.128448
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:4000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4747165044148763,
        0.4747165044148763,
        0.4747165044148763,
        0.5183378458023071,
        0.5302537679672241,
        0.5468099117279053,
        0.5710269212722778,
        0.5934622287750244,
        0.6203268766403198,
        0.6512452363967896,
        0.6767009496688843,
        0.7058109045028687,
        0.7175338864326477,
        0.755341649055481,
        0.7629888653755188,
        0.7660302519798279,
        0.7908281087875366,
        0.7922186255455017,
        0.7922186255455017,
        0.7926962971687317
      ],
      "expected": {
        "calibrated_mae": 0.127505
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:4000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47117717067400616,
        0.47117717067400616,
        0.47117717067400616,
        0.5129854083061218,
        0.5245001316070557,
        0.5408200025558472,
        0.5644264817237854,
        0.5867365598678589,
        0.61336350440979,
        0.644198477268219,
        0.6696778535842896,
        0.6990189552307129,
        0.7111479640007019,
        0.7500064969062805,
        0.7577690482139587,
        0.7607884407043457,
        0.7865082621574402,
        0.7878614068031311,
        0.7878614068031311,
        0.7884600162506104
      ],
      "expected": {
        "calibrated_mae": 0.128121
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:10000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47439122200012207,
        0.47439122200012207,
        0.47439122200012207,
        0.520577073097229,
        0.5335034728050232,
        0.552079975605011,
        0.578433632850647,
        0.6033430695533752,
        0.6335089206695557,
        0.6682500839233398,
        0.6968356370925903,
        0.7281222939491272,
        0.7415390610694885,
        0.7804078459739685,
        0.7877153754234314,
        0.7910282611846924,
        0.8150537610054016,
        0.8163273930549622,
        0.8163273930549622,
        0.8169400691986084
      ],
      "expected": {
        "calibrated_mae": 0.116771
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:10000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48147175709406537,
        0.48147175709406537,
        0.48147175709406537,
        0.5276692509651184,
        0.5408077239990234,
        0.5590237975120544,
        0.5853292942047119,
        0.6097940802574158,
        0.6395979523658752,
        0.6734378337860107,
        0.701517641544342,
        0.7318167090415955,
        0.7447174787521362,
        0.7824300527572632,
        0.7896671891212463,
        0.7929835319519043,
        0.816144585609436,
        0.8175621628761292,
        0.8175621628761292,
        0.8180868625640869
      ],
      "expected": {
        "calibrated_mae": 0.118503
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:10000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4745186467965444,
        0.4745186467965444,
        0.4745186467965444,
        0.5223178863525391,
        0.5356953740119934,
        0.5544448494911194,
        0.5815538763999939,
        0.6067789793014526,
        0.6374233365058899,
        0.6723586320877075,
        0.7010942697525024,
        0.7322666645050049,
        0.7453611493110657,
        0.7835654616355896,
        0.7908960580825806,
        0.794243335723877,
        0.8176207542419434,
        0.818995326757431,
        0.818995326757431,
        0.8194944858551025
      ],
      "expected": {
        "calibrated_mae": 0.115812
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:10000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47062674164772034,
        0.47062674164772034,
        0.47062674164772034,
        0.5167081356048584,
        0.5297123789787292,
        0.5482434034347534,
        0.5747228264808655,
        0.599830150604248,
        0.6302025318145752,
        0.6650209426879883,
        0.6937977075576782,
        0.725300133228302,
        0.7388325333595276,
        0.7783794403076172,
        0.785879909992218,
        0.7892770767211914,
        0.8137104511260986,
        0.8150671422481537,
        0.8150671422481537,
        0.81573885679245
      ],
      "expected": {
        "calibrated_mae": 0.116229
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:25000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4588469962279002,
        0.4588469962279002,
        0.4588469962279002,
        0.5072928667068481,
        0.5210379958152771,
        0.540897011756897,
        0.5688189268112183,
        0.5962738394737244,
        0.629115641117096,
        0.6679260730743408,
        0.700254499912262,
        0.7345460057258606,
        0.7501707673072815,
        0.7940876483917236,
        0.8023500442504883,
        0.8059555888175964,
        0.8323844075202942,
        0.8336157202720642,
        0.8336157202720642,
        0.8341526985168457
      ],
      "expected": {
        "calibrated_mae": 0.105014
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:25000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4680173297723134,
        0.4680173297723134,
        0.4680173297723134,
        0.516854465007782,
        0.5309467911720276,
        0.5504916906356812,
        0.578318178653717,
        0.6052248477935791,
        0.6375337839126587,
        0.6751278042793274,
        0.7066792845726013,
        0.7396735548973083,
        0.7546234130859375,
        0.7966436147689819,
        0.8046090602874756,
        0.8081441521644592,
        0.8332351446151733,
        0.834559977054596,
        0.834559977054596,
        0.8349902033805847
      ],
      "expected": {
        "calibrated_mae": 0.107497
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:25000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4607473313808441,
        0.4607473313808441,
        0.4607473313808441,
        0.5107649564743042,
        0.5250416398048401,
        0.5451034307479858,
        0.5736725926399231,
        0.6014243364334106,
        0.634717583656311,
        0.6736407279968262,
        0.7060918807983398,
        0.7401514649391174,
        0.7554033398628235,
        0.7983010411262512,
        0.8064711689949036,
        0.8100743889808655,
        0.8355762362480164,
        0.8368411064147949,
        0.8368411064147949,
        0.8372492790222168
      ],
      "expected": {
        "calibrated_mae": 0.104284
      }
    },
    {
      "context_key": "hard:triplet-p1:clear-greedy:25000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4573507010936737,
        0.4573507010936737,
        0.4573507010936737,
        0.5057530999183655,
        0.5197081565856934,
        0.5396363139152527,
        0.5676953196525574,
        0.5954297780990601,
        0.6284286975860596,
        0.6672167778015137,
        0.6995535492897034,
        0.7337103486061096,
        0.7493606209754944,
        0.7933692932128906,
        0.8016669750213623,
        0.8051936626434326,
        0.8317357301712036,
        0.8329865038394928,
        0.8329865038394928,
        0.8335464596748352
      ],
      "expected": {
        "calibrated_mae": 0.104837
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4262501299381256,
        0.4262501299381256,
        0.4262501299381256,
        0.4974212944507599,
        0.5172821283340454,
        0.5464589595794678,
        0.5881462097167969,
        0.6264644861221313,
        0.6740782856941223,
        0.7259383797645569,
        0.7658668160438538,
        0.805388867855072,
        0.8213360905647278,
        0.860023021697998,
        0.8675713539123535,
        0.8706570863723755,
        0.889795184135437,
        0.891293466091156,
        0.891293466091156,
        0.8920583128929138
      ],
      "expected": {
        "calibrated_mae": 0.070096
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.43815351525942486,
        0.43815351525942486,
        0.43815351525942486,
        0.5088297724723816,
        0.5288550853729248,
        0.5573420524597168,
        0.5990548133850098,
        0.6368227005004883,
        0.6837130784988403,
        0.7335755228996277,
        0.7720862030982971,
        0.809247612953186,
        0.8241298794746399,
        0.8612154722213745,
        0.8685368895530701,
        0.8716654777526855,
        0.889829158782959,
        0.891453206539154,
        0.891453206539154,
        0.892143726348877
      ],
      "expected": {
        "calibrated_mae": 0.074678
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42857589324315387,
        0.42857589324315387,
        0.42857589324315387,
        0.5000248551368713,
        0.5201011300086975,
        0.5488110780715942,
        0.5909222960472107,
        0.6292754411697388,
        0.6769496202468872,
        0.7281662821769714,
        0.7675459384918213,
        0.8058836460113525,
        0.8211917877197266,
        0.8589287400245667,
        0.8664947152137756,
        0.8696005940437317,
        0.8883361220359802,
        0.8899308741092682,
        0.8899308741092682,
        0.8905263543128967
      ],
      "expected": {
        "calibrated_mae": 0.071714
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42727163434028625,
        0.42727163434028625,
        0.42727163434028625,
        0.4976852238178253,
        0.5174838900566101,
        0.5464357733726501,
        0.5883750915527344,
        0.6271002292633057,
        0.6749952435493469,
        0.7267501354217529,
        0.7663986086845398,
        0.8055066466331482,
        0.8212270736694336,
        0.8598672747612,
        0.8674734830856323,
        0.8706344366073608,
        0.8896172046661377,
        0.8912020921707153,
        0.8912020921707153,
        0.8920277953147888
      ],
      "expected": {
        "calibrated_mae": 0.070407
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:1500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46623526016871136,
        0.46623526016871136,
        0.46623526016871136,
        0.5178176164627075,
        0.5315424799919128,
        0.5507569909095764,
        0.5782321095466614,
        0.6033244729042053,
        0.633965790271759,
        0.6679266691207886,
        0.6954348087310791,
        0.7263107895851135,
        0.7386709451675415,
        0.7769259810447693,
        0.7847122550010681,
        0.7878637909889221,
        0.8121749758720398,
        0.8138227462768555,
        0.8138227462768555,
        0.814520001411438
      ],
      "expected": {
        "calibrated_mae": 0.116576
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:1500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47141233086586,
        0.47141233086586,
        0.47141233086586,
        0.523362934589386,
        0.5374612212181091,
        0.5566284656524658,
        0.5846385359764099,
        0.6097256541252136,
        0.6404474377632141,
        0.6739739775657654,
        0.7013218998908997,
        0.7314533591270447,
        0.743413507938385,
        0.7806889414787292,
        0.7884467244148254,
        0.7916519045829773,
        0.8148632645606995,
        0.8166302740573883,
        0.8166302740573883,
        0.817251443862915
      ],
      "expected": {
        "calibrated_mae": 0.116977
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:1500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46647968888282776,
        0.46647968888282776,
        0.46647968888282776,
        0.5193106532096863,
        0.5334030389785767,
        0.552649974822998,
        0.5807991027832031,
        0.6060693264007568,
        0.6369723081588745,
        0.6708953976631165,
        0.6983872056007385,
        0.7289837002754211,
        0.7410070300102234,
        0.778607189655304,
        0.7864558696746826,
        0.7896625995635986,
        0.8133368492126465,
        0.8150887489318848,
        0.8150887489318848,
        0.8156604170799255
      ],
      "expected": {
        "calibrated_mae": 0.116241
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:1500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4629371960957845,
        0.4629371960957845,
        0.4629371960957845,
        0.5141175389289856,
        0.5279095768928528,
        0.5471286177635193,
        0.5749478936195374,
        0.6004218459129333,
        0.6314393877983093,
        0.6657251119613647,
        0.6935460567474365,
        0.7247506380081177,
        0.737257719039917,
        0.7761112451553345,
        0.7840951085090637,
        0.7873471975326538,
        0.811839759349823,
        0.8135546743869781,
        0.8135546743869781,
        0.8143223524093628
      ],
      "expected": {
        "calibrated_mae": 0.115601
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:4000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4779349664847056,
        0.4779349664847056,
        0.4779349664847056,
        0.5191859006881714,
        0.530449390411377,
        0.5463824272155762,
        0.5691849589347839,
        0.590843915939331,
        0.6165069341659546,
        0.6462236642837524,
        0.6705966591835022,
        0.6987793445587158,
        0.7104676365852356,
        0.7480026483535767,
        0.7554645538330078,
        0.7582385540008545,
        0.7836206555366516,
        0.7848110795021057,
        0.7848110795021057,
        0.7852538824081421
      ],
      "expected": {
        "calibrated_mae": 0.131472
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:4000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4814728895823161,
        0.4814728895823161,
        0.4814728895823161,
        0.5234490036964417,
        0.53510981798172,
        0.551112949848175,
        0.5744763612747192,
        0.596277117729187,
        0.6222916841506958,
        0.6519883275032043,
        0.6765473484992981,
        0.704564094543457,
        0.7160995602607727,
        0.7530533671379089,
        0.7605546116828918,
        0.7633866667747498,
        0.7878540754318237,
        0.7891686856746674,
        0.7891686856746674,
        0.789540708065033
      ],
      "expected": {
        "calibrated_mae": 0.130728
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:4000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47903183102607727,
        0.47903183102607727,
        0.47903183102607727,
        0.5215074419975281,
        0.5331624150276184,
        0.5492339730262756,
        0.5726282000541687,
        0.5945601463317871,
        0.6206886172294617,
        0.6506734490394592,
        0.6754035949707031,
        0.7037521004676819,
        0.7153028845787048,
        0.7526200413703918,
        0.7601494789123535,
        0.7629863023757935,
        0.7878486514091492,
        0.7891071140766144,
        0.7891071140766144,
        0.7894482612609863
      ],
      "expected": {
        "calibrated_mae": 0.130092
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:4000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4747696618239085,
        0.4747696618239085,
        0.4747696618239085,
        0.5155277848243713,
        0.5268145799636841,
        0.5426969528198242,
        0.5655555129051208,
        0.5874189734458923,
        0.6133747696876526,
        0.6433135867118835,
        0.6680721640586853,
        0.69664466381073,
        0.7086012959480286,
        0.746983528137207,
        0.7546434998512268,
        0.7574360966682434,
        0.7832947373390198,
        0.7845151126384735,
        0.7845151126384735,
        0.7849748730659485
      ],
      "expected": {
        "calibrated_mae": 0.130603
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:10000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4781441887219747,
        0.4781441887219747,
        0.4781441887219747,
        0.5234116315841675,
        0.5360947251319885,
        0.5541577935218811,
        0.5796774625778198,
        0.6039879322052002,
        0.6333217024803162,
        0.6668581962585449,
        0.6945074796676636,
        0.7248921394348145,
        0.7380653619766235,
        0.7765695452690125,
        0.7838462591171265,
        0.7870140671730042,
        0.8113443851470947,
        0.8125459551811218,
        0.8125459551811218,
        0.8130422234535217
      ],
      "expected": {
        "calibrated_mae": 0.11966
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:10000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4853456914424896,
        0.4853456914424896,
        0.4853456914424896,
        0.530622661113739,
        0.5435346364974976,
        0.5612580180168152,
        0.5867465734481812,
        0.610612690448761,
        0.6395857930183411,
        0.6722739934921265,
        0.6994786262512207,
        0.7289475798606873,
        0.7416213154792786,
        0.7789475321769714,
        0.7861486077308655,
        0.7893278002738953,
        0.8126944899559021,
        0.8140364587306976,
        0.8140364587306976,
        0.8144484162330627
      ],
      "expected": {
        "calibrated_mae": 0.12129
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:10000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4793764154116313,
        0.4793764154116313,
        0.4793764154116313,
        0.5259738564491272,
        0.5390442609786987,
        0.557171106338501,
        0.5832545161247253,
        0.6077332496643066,
        0.6373502016067505,
        0.6709458231925964,
        0.6986899375915527,
        0.7289268970489502,
        0.7417809367179871,
        0.779646635055542,
        0.7869430780410767,
        0.7901440858840942,
        0.8138227462768555,
        0.815115749835968,
        0.815115749835968,
        0.8154870867729187
      ],
      "expected": {
        "calibrated_mae": 0.11907
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:10000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4746886094411214,
        0.4746886094411214,
        0.4746886094411214,
        0.5196323394775391,
        0.5323734283447266,
        0.5503349900245667,
        0.5758854150772095,
        0.6003284454345703,
        0.6297815442085266,
        0.6633489727973938,
        0.6911687850952148,
        0.7217603325843811,
        0.7350566983222961,
        0.7742781043052673,
        0.7817596793174744,
        0.7849900722503662,
        0.8097885847091675,
        0.8110596835613251,
        0.8110596835613251,
        0.8116037249565125
      ],
      "expected": {
        "calibrated_mae": 0.119294
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:25000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4605679710706075,
        0.4605679710706075,
        0.4605679710706075,
        0.5078316330909729,
        0.5213584899902344,
        0.5407788753509521,
        0.56795334815979,
        0.5950180292129517,
        0.6272539496421814,
        0.6651222109794617,
        0.6967540979385376,
        0.7303647398948669,
        0.745864987373352,
        0.7896301746368408,
        0.7979126572608948,
        0.8013548851013184,
        0.8282949328422546,
        0.8294407427310944,
        0.8294407427310944,
        0.8298360705375671
      ],
      "expected": {
        "calibrated_mae": 0.107362
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:25000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47021764516830444,
        0.47021764516830444,
        0.47021764516830444,
        0.5179663300514221,
        0.5318723917007446,
        0.551014244556427,
        0.5781468749046326,
        0.6046756505966187,
        0.6364001631736755,
        0.6731024980545044,
        0.7039859294891357,
        0.7363052368164062,
        0.7511115670204163,
        0.7928870916366577,
        0.8008596301078796,
        0.8042557835578918,
        0.8297184705734253,
        0.830966591835022,
        0.830966591835022,
        0.8312656879425049
      ],
      "expected": {
        "calibrated_mae": 0.109733
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:25000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4634857475757599,
        0.4634857475757599,
        0.4634857475757599,
        0.5121769309043884,
        0.5262080430984497,
        0.5457738637924194,
        0.5735037922859192,
        0.6007860898971558,
        0.6333619356155396,
        0.671269953250885,
        0.7029693126678467,
        0.7362905144691467,
        0.7513847351074219,
        0.794059157371521,
        0.8022326827049255,
        0.8056780695915222,
        0.8316279649734497,
        0.8328061401844025,
        0.8328061401844025,
        0.8330656886100769
      ],
      "expected": {
        "calibrated_mae": 0.106872
      }
    },
    {
      "context_key": "hard:triplet-p1:survival:25000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "triplet-p1",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.45926931500434875,
        0.45926931500434875,
        0.45926931500434875,
        0.5063335299491882,
        0.5200589299201965,
        0.539510190486908,
        0.5667791962623596,
        0.5940845608711243,
        0.6264342069625854,
        0.6642668843269348,
        0.695888876914978,
        0.7293530106544495,
        0.7448683381080627,
        0.7887325882911682,
        0.7970576882362366,
        0.800413191318512,
        0.8274976015090942,
        0.8286586105823517,
        0.8286586105823517,
        0.8290705680847168
      ],
      "expected": {
        "calibrated_mae": 0.107295
      }
    },
    {
      "context_key": "hard:budget-p2:random:500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42683354020118713,
        0.42683354020118713,
        0.42683354020118713,
        0.4986805021762848,
        0.5183959007263184,
        0.547578752040863,
        0.5895115733146667,
        0.6258562803268433,
        0.6685799956321716,
        0.713416337966919,
        0.7478156685829163,
        0.7814590334892273,
        0.7954225540161133,
        0.8333220481872559,
        0.8413451910018921,
        0.8440617322921753,
        0.8657732009887695,
        0.8673525154590607,
        0.8673525154590607,
        0.8680353164672852
      ],
      "expected": {
        "calibrated_mae": 0.082655
      }
    },
    {
      "context_key": "hard:budget-p2:random:500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.43782087167104083,
        0.43782087167104083,
        0.43782087167104083,
        0.5101330280303955,
        0.5297921299934387,
        0.557957649230957,
        0.5987046957015991,
        0.6335127949714661,
        0.6749292016029358,
        0.7181147336959839,
        0.7520732283592224,
        0.7849863767623901,
        0.7984956502914429,
        0.8358194231987,
        0.8437694907188416,
        0.8466306924819946,
        0.8672963976860046,
        0.8690372705459595,
        0.8690372705459595,
        0.8696573972702026
      ],
      "expected": {
        "calibrated_mae": 0.085646
      }
    },
    {
      "context_key": "hard:budget-p2:random:500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4271869858105977,
        0.4271869858105977,
        0.4271869858105977,
        0.5005769729614258,
        0.5206092000007629,
        0.5493780970573425,
        0.5911031365394592,
        0.626775860786438,
        0.6688547134399414,
        0.7128698825836182,
        0.7471194863319397,
        0.7805251479148865,
        0.7942347526550293,
        0.8319557309150696,
        0.8401045203208923,
        0.8429296016693115,
        0.8643989562988281,
        0.8661296963691711,
        0.8661296963691711,
        0.8666555881500244
      ],
      "expected": {
        "calibrated_mae": 0.083758
      }
    },
    {
      "context_key": "hard:budget-p2:random:500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42905015746752423,
        0.42905015746752423,
        0.42905015746752423,
        0.49942904710769653,
        0.5187170505523682,
        0.5470401048660278,
        0.5880118012428284,
        0.6238218545913696,
        0.6661521792411804,
        0.7108388543128967,
        0.745303213596344,
        0.7792613506317139,
        0.7932713627815247,
        0.8317163586616516,
        0.8398711085319519,
        0.8426855802536011,
        0.8644294142723083,
        0.8660819232463837,
        0.8660819232463837,
        0.8668320178985596
      ],
      "expected": {
        "calibrated_mae": 0.083665
      }
    },
    {
      "context_key": "hard:budget-p2:random:1500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.45990978678067523,
        0.45990978678067523,
        0.45990978678067523,
        0.5106874704360962,
        0.523804783821106,
        0.5421846508979797,
        0.5681238174438477,
        0.5910529494285583,
        0.6184254288673401,
        0.6482104659080505,
        0.6726639866828918,
        0.699674665927887,
        0.71065753698349,
        0.7467566728591919,
        0.7542995810508728,
        0.7567330598831177,
        0.7817161083221436,
        0.7831461429595947,
        0.7831461429595947,
        0.7835308313369751
      ],
      "expected": {
        "calibrated_mae": 0.128141
      }
    },
    {
      "context_key": "hard:budget-p2:random:1500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4647088944911957,
        0.4647088944911957,
        0.4647088944911957,
        0.516049861907959,
        0.5293839573860168,
        0.5475564002990723,
        0.5735877752304077,
        0.5962134599685669,
        0.6235036253929138,
        0.6529447436332703,
        0.6775116324424744,
        0.7044010758399963,
        0.7152370810508728,
        0.7510220408439636,
        0.7586939334869385,
        0.7612698674201965,
        0.7853982448577881,
        0.786991149187088,
        0.786991149187088,
        0.7873327136039734
      ],
      "expected": {
        "calibrated_mae": 0.128099
      }
    },
    {
      "context_key": "hard:budget-p2:random:1500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.45895011226336163,
        0.45895011226336163,
        0.45895011226336163,
        0.511359691619873,
        0.5248087644577026,
        0.5431472063064575,
        0.5694344639778137,
        0.5922889709472656,
        0.6196700930595398,
        0.6493130922317505,
        0.6738287210464478,
        0.7008586525917053,
        0.7116631865501404,
        0.7475544810295105,
        0.7552454471588135,
        0.7577981352806091,
        0.7824421525001526,
        0.784021258354187,
        0.784021258354187,
        0.7843050360679626
      ],
      "expected": {
        "calibrated_mae": 0.127793
      }
    },
    {
      "context_key": "hard:budget-p2:random:1500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4578921397527059,
        0.4578921397527059,
        0.4578921397527059,
        0.5075357556343079,
        0.5205028653144836,
        0.5385926365852356,
        0.5643815994262695,
        0.5873457193374634,
        0.6148560047149658,
        0.6448913812637329,
        0.6696467995643616,
        0.6970913410186768,
        0.7082716822624207,
        0.745007336139679,
        0.7527377605438232,
        0.7552472949028015,
        0.7804591655731201,
        0.7819163203239441,
        0.7819163203239441,
        0.7823473215103149
      ],
      "expected": {
        "calibrated_mae": 0.127836
      }
    },
    {
      "context_key": "hard:budget-p2:random:4000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47114697098731995,
        0.47114697098731995,
        0.47114697098731995,
        0.5118329524993896,
        0.5225265026092529,
        0.5376715660095215,
        0.559160590171814,
        0.5790854692459106,
        0.602491557598114,
        0.629237949848175,
        0.6514275074005127,
        0.6766259074211121,
        0.6871368885040283,
        0.7221322655677795,
        0.7291553020477295,
        0.7312595248222351,
        0.7563064098358154,
        0.7573042809963226,
        0.7573042809963226,
        0.7574537992477417
      ],
      "expected": {
        "calibrated_mae": 0.141011
      }
    },
    {
      "context_key": "hard:budget-p2:random:4000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47394852836926776,
        0.47394852836926776,
        0.47394852836926776,
        0.5153974294662476,
        0.5263909697532654,
        0.5415406227111816,
        0.5633799433708191,
        0.583299994468689,
        0.6069383025169373,
        0.6336413621902466,
        0.656112015247345,
        0.6814549565315247,
        0.691952645778656,
        0.7268933653831482,
        0.7340927124023438,
        0.7363280653953552,
        0.7607983350753784,
        0.7619509696960449,
        0.7619509696960449,
        0.7620548009872437
      ],
      "expected": {
        "calibrated_mae": 0.140046
      }
    },
    {
      "context_key": "hard:budget-p2:random:4000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47100497285525006,
        0.47100497285525006,
        0.47100497285525006,
        0.5127173066139221,
        0.5237031579017639,
        0.5388662219047546,
        0.5607201457023621,
        0.5807667970657349,
        0.6044991612434387,
        0.6314524412155151,
        0.654024064540863,
        0.679601788520813,
        0.6900694370269775,
        0.725230872631073,
        0.7324166297912598,
        0.7346229553222656,
        0.7594619393348694,
        0.7605669498443604,
        0.7605669498443604,
        0.7606346011161804
      ],
      "expected": {
        "calibrated_mae": 0.13975
      }
    },
    {
      "context_key": "hard:budget-p2:random:4000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4694555401802063,
        0.4694555401802063,
        0.4694555401802063,
        0.5090070962905884,
        0.5195674896240234,
        0.5344666242599487,
        0.5557048320770264,
        0.5756150484085083,
        0.5991347432136536,
        0.626014232635498,
        0.6485012173652649,
        0.6740809082984924,
        0.6848424673080444,
        0.720564067363739,
        0.7277411222457886,
        0.7298531532287598,
        0.7553274035453796,
        0.756328284740448,
        0.756328284740448,
        0.7564733028411865
      ],
      "expected": {
        "calibrated_mae": 0.140758
      }
    },
    {
      "context_key": "hard:budget-p2:random:10000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4713914692401886,
        0.4713914692401886,
        0.4713914692401886,
        0.5162315964698792,
        0.5283324718475342,
        0.5456990003585815,
        0.5701910853385925,
        0.5929377675056458,
        0.620064914226532,
        0.6506747603416443,
        0.6759839653968811,
        0.7033709287643433,
        0.7152178287506104,
        0.751431405544281,
        0.7584507465362549,
        0.7609781622886658,
        0.785526692867279,
        0.7866230905056,
        0.7866230905056,
        0.7868950366973877
      ],
      "expected": {
        "calibrated_mae": 0.128761
      }
    },
    {
      "context_key": "hard:budget-p2:random:10000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47745223840077716,
        0.47745223840077716,
        0.47745223840077716,
        0.522363543510437,
        0.5346053838729858,
        0.5516188740730286,
        0.5759339928627014,
        0.5981747508049011,
        0.6249492168426514,
        0.654865026473999,
        0.6799929738044739,
        0.7069644331932068,
        0.7185459136962891,
        0.7542170286178589,
        0.7612974643707275,
        0.7639315724372864,
        0.7877496480941772,
        0.7890144884586334,
        0.7890144884586334,
        0.7892306447029114
      ],
      "expected": {
        "calibrated_mae": 0.129727
      }
    },
    {
      "context_key": "hard:budget-p2:random:10000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4709611137708028,
        0.4709611137708028,
        0.4709611137708028,
        0.5170254111289978,
        0.529446005821228,
        0.5468195080757141,
        0.5717038512229919,
        0.5945259928703308,
        0.6218466758728027,
        0.6525172591209412,
        0.6780503392219543,
        0.705582857131958,
        0.7172790169715881,
        0.753341019153595,
        0.7604694962501526,
        0.7630968689918518,
        0.7872852087020874,
        0.7885037958621979,
        0.7885037958621979,
        0.7886703014373779
      ],
      "expected": {
        "calibrated_mae": 0.128015
      }
    },
    {
      "context_key": "hard:budget-p2:random:10000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4695718785127004,
        0.4695718785127004,
        0.4695718785127004,
        0.5133752822875977,
        0.5253328680992126,
        0.5423441529273987,
        0.5664284825325012,
        0.5889766216278076,
        0.6159538626670837,
        0.6464383602142334,
        0.671837329864502,
        0.6995014548301697,
        0.7114986777305603,
        0.748468279838562,
        0.7556804418563843,
        0.7582675814628601,
        0.7832770347595215,
        0.7844121754169464,
        0.7844121754169464,
        0.7847132086753845
      ],
      "expected": {
        "calibrated_mae": 0.129099
      }
    },
    {
      "context_key": "hard:budget-p2:random:25000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4585154056549072,
        0.4585154056549072,
        0.4585154056549072,
        0.5038250684738159,
        0.5163552165031433,
        0.5345088839530945,
        0.5599544644355774,
        0.5848361849784851,
        0.6144973039627075,
        0.6492473483085632,
        0.6784369349479675,
        0.7095456719398499,
        0.7237728238105774,
        0.7655406594276428,
        0.7736444473266602,
        0.7765018939971924,
        0.8037471771240234,
        0.8048372864723206,
        0.8048372864723206,
        0.8050034046173096
      ],
      "expected": {
        "calibrated_mae": 0.117188
      }
    },
    {
      "context_key": "hard:budget-p2:random:25000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46633589267730713,
        0.46633589267730713,
        0.46633589267730713,
        0.5119725465774536,
        0.5247958898544312,
        0.5427212119102478,
        0.5681513547897339,
        0.5926222205162048,
        0.6219919919967651,
        0.6559438109397888,
        0.6847700476646423,
        0.7151305675506592,
        0.7289162874221802,
        0.7694176435470581,
        0.7773774266242981,
        0.7802771329879761,
        0.8063223958015442,
        0.8075432479381561,
        0.8075432479381561,
        0.8076390624046326
      ],
      "expected": {
        "calibrated_mae": 0.118487
      }
    },
    {
      "context_key": "hard:budget-p2:random:25000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4600667655467987,
        0.4600667655467987,
        0.4600667655467987,
        0.5062260627746582,
        0.519098162651062,
        0.5372409224510193,
        0.5630325078964233,
        0.5880187749862671,
        0.6179788708686829,
        0.6528523564338684,
        0.6822963953018188,
        0.7135176658630371,
        0.7275403141975403,
        0.7689160704612732,
        0.7770570516586304,
        0.7799878120422363,
        0.806634247303009,
        0.8078015446662903,
        0.8078015446662903,
        0.8078488707542419
      ],
      "expected": {
        "calibrated_mae": 0.116445
      }
    },
    {
      "context_key": "hard:budget-p2:random:25000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "random",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4588666558265686,
        0.4588666558265686,
        0.4588666558265686,
        0.5033416152000427,
        0.5158820152282715,
        0.53383868932724,
        0.5590094923973083,
        0.5838141441345215,
        0.6133139729499817,
        0.6478114724159241,
        0.6768345236778259,
        0.7077919244766235,
        0.7220117449760437,
        0.7639287710189819,
        0.7720806002616882,
        0.7748640179634094,
        0.8023028373718262,
        0.8034055531024933,
        0.8034055531024933,
        0.8035795092582703
      ],
      "expected": {
        "calibrated_mae": 0.117857
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4166891276836395,
        0.4166891276836395,
        0.4166891276836395,
        0.48419898748397827,
        0.5047850608825684,
        0.5372260212898254,
        0.5872278809547424,
        0.6315637826919556,
        0.6835398077964783,
        0.7368358373641968,
        0.7757114768028259,
        0.8110840320587158,
        0.825209379196167,
        0.8609923720359802,
        0.868272602558136,
        0.870973527431488,
        0.8896340727806091,
        0.8911963999271393,
        0.8911963999271393,
        0.8920356631278992
      ],
      "expected": {
        "calibrated_mae": 0.06709
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4258642792701721,
        0.4258642792701721,
        0.4258642792701721,
        0.49580252170562744,
        0.5166409611701965,
        0.5481520891189575,
        0.5965709090232849,
        0.6386791467666626,
        0.6885418891906738,
        0.7395660877227783,
        0.7779394388198853,
        0.8126694560050964,
        0.8264617919921875,
        0.8622034192085266,
        0.8694872856140137,
        0.8723894953727722,
        0.8904932737350464,
        0.8922410309314728,
        0.8922410309314728,
        0.8930341005325317
      ],
      "expected": {
        "calibrated_mae": 0.070752
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.41210124890009564,
        0.41210124890009564,
        0.41210124890009564,
        0.48221033811569214,
        0.5037056803703308,
        0.5366187691688538,
        0.5877153277397156,
        0.6321659088134766,
        0.6841011643409729,
        0.7368164658546448,
        0.775719940662384,
        0.810932457447052,
        0.8247759342193604,
        0.8603003621101379,
        0.867727518081665,
        0.8705602288246155,
        0.8890166282653809,
        0.8907520473003387,
        0.8907520473003387,
        0.8914809823036194
      ],
      "expected": {
        "calibrated_mae": 0.066514
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.41571761171023053,
        0.41571761171023053,
        0.41571761171023053,
        0.4836884140968323,
        0.5042399168014526,
        0.5365049242973328,
        0.5863900184631348,
        0.630791962146759,
        0.6830301284790039,
        0.736677348613739,
        0.7758452296257019,
        0.8114983439445496,
        0.8255816698074341,
        0.8615479469299316,
        0.8689044117927551,
        0.8717547059059143,
        0.8902010321617126,
        0.8918771743774414,
        0.8918771743774414,
        0.8928194046020508
      ],
      "expected": {
        "calibrated_mae": 0.066462
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:1500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46185805400212604,
        0.46185805400212604,
        0.46185805400212604,
        0.51488196849823,
        0.5292092561721802,
        0.5499522089958191,
        0.5799072980880737,
        0.6061015725135803,
        0.6373440027236938,
        0.6710163354873657,
        0.6982981562614441,
        0.7274591326713562,
        0.7390280961990356,
        0.776081383228302,
        0.7837777733802795,
        0.7866934537887573,
        0.810729444026947,
        0.8124170899391174,
        0.8124170899391174,
        0.8131030797958374
      ],
      "expected": {
        "calibrated_mae": 0.116065
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:1500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4653506378332774,
        0.4653506378332774,
        0.4653506378332774,
        0.5195019841194153,
        0.5341041684150696,
        0.5546690225601196,
        0.5846973657608032,
        0.6105207800865173,
        0.6415833234786987,
        0.6748086810112,
        0.7021453976631165,
        0.7311053276062012,
        0.7425206899642944,
        0.7793645858764648,
        0.7871960401535034,
        0.7902728319168091,
        0.8136312961578369,
        0.8155085444450378,
        0.8155085444450378,
        0.8161535859107971
      ],
      "expected": {
        "calibrated_mae": 0.116113
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:1500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.45698856314023334,
        0.45698856314023334,
        0.45698856314023334,
        0.5127519965171814,
        0.5277280211448669,
        0.5489131212234497,
        0.5798990726470947,
        0.6064390540122986,
        0.6381007432937622,
        0.6718935966491699,
        0.6993781328201294,
        0.7286484837532043,
        0.7400139570236206,
        0.7768771648406982,
        0.7847760915756226,
        0.7878494262695312,
        0.8115974068641663,
        0.8134872019290924,
        0.8134872019290924,
        0.814106285572052
      ],
      "expected": {
        "calibrated_mae": 0.114602
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:1500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.45797353982925415,
        0.45797353982925415,
        0.45797353982925415,
        0.511076807975769,
        0.5254253149032593,
        0.5461593866348267,
        0.5763627290725708,
        0.602850079536438,
        0.6345263123512268,
        0.668705403804779,
        0.6964465379714966,
        0.7261894941329956,
        0.7379661798477173,
        0.7757915258407593,
        0.7837239503860474,
        0.7868135571479797,
        0.8110647201538086,
        0.8128589391708374,
        0.8128589391708374,
        0.8136501908302307
      ],
      "expected": {
        "calibrated_mae": 0.11468
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:4000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4749349256356557,
        0.4749349256356557,
        0.4749349256356557,
        0.5169391632080078,
        0.528239369392395,
        0.5446246862411499,
        0.5684201717376709,
        0.59022456407547,
        0.6160346865653992,
        0.6454412937164307,
        0.6698458790779114,
        0.6970894932746887,
        0.7083011269569397,
        0.7450149059295654,
        0.7524165511131287,
        0.7550855875015259,
        0.7801158428192139,
        0.7814023792743683,
        0.7814023792743683,
        0.7818176746368408
      ],
      "expected": {
        "calibrated_mae": 0.132035
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:4000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4767398734887441,
        0.4767398734887441,
        0.4767398734887441,
        0.5199030041694641,
        0.5315626263618469,
        0.5480242967605591,
        0.5722580552101135,
        0.5940962433815002,
        0.620166540145874,
        0.6495538949966431,
        0.6742557883262634,
        0.7016628384590149,
        0.7128724455833435,
        0.7496476173400879,
        0.7572318315505981,
        0.7600467205047607,
        0.7845504283905029,
        0.7860105931758881,
        0.7860105931758881,
        0.7863821983337402
      ],
      "expected": {
        "calibrated_mae": 0.130868
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:4000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47224995493888855,
        0.47224995493888855,
        0.47224995493888855,
        0.5161087512969971,
        0.5278756618499756,
        0.5445488095283508,
        0.5691016912460327,
        0.591279923915863,
        0.6177117228507996,
        0.6475656628608704,
        0.672523558139801,
        0.700312077999115,
        0.7115131616592407,
        0.748530924320221,
        0.7561436891555786,
        0.7589505314826965,
        0.7837860584259033,
        0.7852075099945068,
        0.7852075099945068,
        0.78555828332901
      ],
      "expected": {
        "calibrated_mae": 0.129872
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:4000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4720308780670166,
        0.4720308780670166,
        0.4720308780670166,
        0.5137084722518921,
        0.5249705910682678,
        0.5412440896034241,
        0.5649657249450684,
        0.586859941482544,
        0.6129233837127686,
        0.6426037549972534,
        0.6674497127532959,
        0.6953068971633911,
        0.7068520784378052,
        0.7446166276931763,
        0.7522366046905518,
        0.7549960613250732,
        0.7805124521255493,
        0.7818514704704285,
        0.7818514704704285,
        0.7822969555854797
      ],
      "expected": {
        "calibrated_mae": 0.130977
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:10000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47488391399383545,
        0.47488391399383545,
        0.47488391399383545,
        0.5204272866249084,
        0.5330778956413269,
        0.5516976118087769,
        0.5787011981010437,
        0.6037220358848572,
        0.6339361071586609,
        0.668112576007843,
        0.6964015364646912,
        0.7263003587722778,
        0.7390979528427124,
        0.7767862677574158,
        0.7839557528495789,
        0.7869448661804199,
        0.8107420206069946,
        0.8120091557502747,
        0.8120091557502747,
        0.8125082850456238
      ],
      "expected": {
        "calibrated_mae": 0.118535
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:10000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4801935851573944,
        0.4801935851573944,
        0.4801935851573944,
        0.5263894200325012,
        0.5392634868621826,
        0.5575740337371826,
        0.5843935608863831,
        0.6088208556175232,
        0.6385318636894226,
        0.6718038320541382,
        0.6997603178024292,
        0.7291204333305359,
        0.7416209578514099,
        0.7788216471672058,
        0.7860515117645264,
        0.7891558408737183,
        0.812373697757721,
        0.8138345181941986,
        0.8138345181941986,
        0.814279317855835
      ],
      "expected": {
        "calibrated_mae": 0.119713
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:10000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4713690181573232,
        0.4713690181573232,
        0.4713690181573232,
        0.5189839601516724,
        0.5321725010871887,
        0.5511293411254883,
        0.5790586471557617,
        0.6045129299163818,
        0.635350227355957,
        0.6699271202087402,
        0.6986564993858337,
        0.7288689613342285,
        0.741532564163208,
        0.7790998220443726,
        0.7864059209823608,
        0.7895169854164124,
        0.8129183053970337,
        0.814329981803894,
        0.814329981803894,
        0.8147452473640442
      ],
      "expected": {
        "calibrated_mae": 0.116717
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:10000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47126707434654236,
        0.47126707434654236,
        0.47126707434654236,
        0.5168628692626953,
        0.5295383930206299,
        0.5480615496635437,
        0.5749779939651489,
        0.6000005602836609,
        0.6302906274795532,
        0.6645190715789795,
        0.6930453777313232,
        0.7234179377555847,
        0.7364357113838196,
        0.7751252055168152,
        0.7825363874435425,
        0.7856727242469788,
        0.809968888759613,
        0.8113342225551605,
        0.8113342225551605,
        0.8119034767150879
      ],
      "expected": {
        "calibrated_mae": 0.11788
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:25000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4622865815957387,
        0.4622865815957387,
        0.4622865815957387,
        0.5096357464790344,
        0.5228027105331421,
        0.5422245264053345,
        0.5699157118797302,
        0.5966834425926208,
        0.6289302110671997,
        0.6666668057441711,
        0.6983811259269714,
        0.7316871881484985,
        0.7467684149742126,
        0.7899343371391296,
        0.7981429696083069,
        0.8014611005783081,
        0.8277878165245056,
        0.8290236294269562,
        0.8290236294269562,
        0.8294498324394226
      ],
      "expected": {
        "calibrated_mae": 0.107904
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:25000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46941637992858887,
        0.46941637992858887,
        0.46941637992858887,
        0.517365038394928,
        0.5308621525764465,
        0.5500399470329285,
        0.5776737332344055,
        0.6039570569992065,
        0.6358045339584351,
        0.6725687980651855,
        0.7037903666496277,
        0.7362397909164429,
        0.7508586049079895,
        0.7927805781364441,
        0.800827145576477,
        0.8041707873344421,
        0.829425573348999,
        0.8307920694351196,
        0.8307920694351196,
        0.8311342597007751
      ],
      "expected": {
        "calibrated_mae": 0.109496
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:25000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4614330430825551,
        0.4614330430825551,
        0.4614330430825551,
        0.5103193521499634,
        0.5239810943603516,
        0.5436033606529236,
        0.5719561576843262,
        0.5990390181541443,
        0.6318628787994385,
        0.669924795627594,
        0.7020406723022461,
        0.7355915307998657,
        0.7505085468292236,
        0.793360710144043,
        0.8016265034675598,
        0.8050338625907898,
        0.8307706713676453,
        0.8320816159248352,
        0.8320816159248352,
        0.832400381565094
      ],
      "expected": {
        "calibrated_mae": 0.10645
      }
    },
    {
      "context_key": "hard:budget-p2:clear-greedy:25000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "clear-greedy",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4614405632019043,
        0.4614405632019043,
        0.4614405632019043,
        0.5087387561798096,
        0.5220470428466797,
        0.5414612293243408,
        0.5691052675247192,
        0.5959853529930115,
        0.6282746195793152,
        0.6659395098686218,
        0.6976460814476013,
        0.7309702634811401,
        0.74614417552948,
        0.789678692817688,
        0.7979734539985657,
        0.8012776970863342,
        0.8278114199638367,
        0.8290842175483704,
        0.8290842175483704,
        0.8295426964759827
      ],
      "expected": {
        "calibrated_mae": 0.107707
      }
    },
    {
      "context_key": "hard:budget-p2:survival:500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42353951930999756,
        0.42353951930999756,
        0.42353951930999756,
        0.49101048707962036,
        0.511161744594574,
        0.5423784852027893,
        0.5896614789962769,
        0.6318515539169312,
        0.6817324161529541,
        0.7330600619316101,
        0.7712689638137817,
        0.80660080909729,
        0.820900559425354,
        0.8574851155281067,
        0.8649801015853882,
        0.867682158946991,
        0.8870181441307068,
        0.8885537683963776,
        0.8885537683963776,
        0.8893133997917175
      ],
      "expected": {
        "calibrated_mae": 0.070589
      }
    },
    {
      "context_key": "hard:budget-p2:survival:500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4333193103472392,
        0.4333193103472392,
        0.4333193103472392,
        0.5028352737426758,
        0.5232158303260803,
        0.5535817742347717,
        0.5996121764183044,
        0.6398826241493225,
        0.687894880771637,
        0.7370734214782715,
        0.774655282497406,
        0.8091446161270142,
        0.823003351688385,
        0.859217643737793,
        0.8666654229164124,
        0.8695557713508606,
        0.8881365060806274,
        0.8898563385009766,
        0.8898563385009766,
        0.8905737400054932
      ],
      "expected": {
        "calibrated_mae": 0.074303
      }
    },
    {
      "context_key": "hard:budget-p2:survival:500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.42106566826502484,
        0.42106566826502484,
        0.42106566826502484,
        0.4909933805465698,
        0.5118178725242615,
        0.5431226491928101,
        0.5909011960029602,
        0.63278728723526,
        0.6823329925537109,
        0.732961893081665,
        0.7711146473884583,
        0.8062244057655334,
        0.8202419877052307,
        0.8565573692321777,
        0.8641873598098755,
        0.8670089244842529,
        0.8860771059989929,
        0.8877643644809723,
        0.8877643644809723,
        0.8883963823318481
      ],
      "expected": {
        "calibrated_mae": 0.070772
      }
    },
    {
      "context_key": "hard:budget-p2:survival:500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4241011142730713,
        0.4241011142730713,
        0.4241011142730713,
        0.4917640686035156,
        0.5117518305778503,
        0.5425146818161011,
        0.589227557182312,
        0.631111741065979,
        0.6809127926826477,
        0.7323741912841797,
        0.7708301544189453,
        0.8065066337585449,
        0.8208428025245667,
        0.8578186631202698,
        0.8654278516769409,
        0.8682765960693359,
        0.8874626159667969,
        0.8891003429889679,
        0.8891003429889679,
        0.8899514675140381
      ],
      "expected": {
        "calibrated_mae": 0.070465
      }
    },
    {
      "context_key": "hard:budget-p2:survival:1500:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46592747171719867,
        0.46592747171719867,
        0.46592747171719867,
        0.5178118348121643,
        0.5317474603652954,
        0.5517804026603699,
        0.5805656313896179,
        0.6059985160827637,
        0.6363788843154907,
        0.6690157055854797,
        0.6955819129943848,
        0.7242211103439331,
        0.7356848120689392,
        0.7724537253379822,
        0.7800806760787964,
        0.7828488349914551,
        0.8070274591445923,
        0.8086107671260834,
        0.8086107671260834,
        0.8091778755187988
      ],
      "expected": {
        "calibrated_mae": 0.118905
      }
    },
    {
      "context_key": "hard:budget-p2:survival:1500:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4697135388851166,
        0.4697135388851166,
        0.4697135388851166,
        0.5226907134056091,
        0.5369251370429993,
        0.556815505027771,
        0.5857633352279663,
        0.610891580581665,
        0.6411381363868713,
        0.6733816862106323,
        0.7000141143798828,
        0.728425145149231,
        0.7397127747535706,
        0.7761566638946533,
        0.783905029296875,
        0.7868319153785706,
        0.8102314472198486,
        0.8120052814483643,
        0.8120052814483643,
        0.8125393390655518
      ],
      "expected": {
        "calibrated_mae": 0.118876
      }
    },
    {
      "context_key": "hard:budget-p2:survival:1500:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46258682012557983,
        0.46258682012557983,
        0.46258682012557983,
        0.5167034268379211,
        0.5311433672904968,
        0.5513902306556702,
        0.5809028148651123,
        0.6064953207969666,
        0.6371334195137024,
        0.6698213219642639,
        0.6965708136558533,
        0.7253162264823914,
        0.736595094203949,
        0.7731937766075134,
        0.7810095548629761,
        0.7839231491088867,
        0.8077726364135742,
        0.8095306158065796,
        0.8095306158065796,
        0.8100180625915527
      ],
      "expected": {
        "calibrated_mae": 0.11788
      }
    },
    {
      "context_key": "hard:budget-p2:survival:1500:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 1500,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4629542628924052,
        0.4629542628924052,
        0.4629542628924052,
        0.5144996047019958,
        0.5283682346343994,
        0.5482324361801147,
        0.5770354270935059,
        0.6026114225387573,
        0.6332688331604004,
        0.6663106083869934,
        0.6933064460754395,
        0.7225169539451599,
        0.7342208027839661,
        0.7718327641487122,
        0.779708743095398,
        0.7826266288757324,
        0.8070856928825378,
        0.8087556660175323,
        0.8087556660175323,
        0.809410035610199
      ],
      "expected": {
        "calibrated_mae": 0.117885
      }
    },
    {
      "context_key": "hard:budget-p2:survival:4000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4782150785128276,
        0.4782150785128276,
        0.4782150785128276,
        0.5192174911499023,
        0.5302333831787109,
        0.5461171269416809,
        0.5690226554870605,
        0.590278148651123,
        0.6153824329376221,
        0.643897533416748,
        0.6675944924354553,
        0.6942309141159058,
        0.705284833908081,
        0.7415123581886292,
        0.7487838864326477,
        0.7512497305870056,
        0.7762954235076904,
        0.7774512469768524,
        0.7774512469768524,
        0.7777364253997803
      ],
      "expected": {
        "calibrated_mae": 0.134638
      }
    },
    {
      "context_key": "hard:budget-p2:survival:4000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48031391700108844,
        0.48031391700108844,
        0.48031391700108844,
        0.52243971824646,
        0.5338302254676819,
        0.5498034954071045,
        0.5731902122497559,
        0.594520628452301,
        0.6199228167533875,
        0.6484690308570862,
        0.6724857687950134,
        0.6992774605751038,
        0.710325300693512,
        0.7465381026268005,
        0.7539872527122498,
        0.7566006183624268,
        0.7810649871826172,
        0.7823964059352875,
        0.7823964059352875,
        0.7826451659202576
      ],
      "expected": {
        "calibrated_mae": 0.133391
      }
    },
    {
      "context_key": "hard:budget-p2:survival:4000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47674445311228436,
        0.47674445311228436,
        0.47674445311228436,
        0.5192628502845764,
        0.5306808352470398,
        0.5467349290847778,
        0.5702337026596069,
        0.5917620658874512,
        0.6173723340034485,
        0.6462643146514893,
        0.6704666018486023,
        0.6976001262664795,
        0.7086381912231445,
        0.7451257705688477,
        0.7525915503501892,
        0.7551857829093933,
        0.7800101041793823,
        0.7812846899032593,
        0.7812846899032593,
        0.7814990878105164
      ],
      "expected": {
        "calibrated_mae": 0.132784
      }
    },
    {
      "context_key": "hard:budget-p2:survival:4000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 4000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4757879177729289,
        0.4757879177729289,
        0.4757879177729289,
        0.5162381529808044,
        0.527191162109375,
        0.5429104566574097,
        0.5656675100326538,
        0.5869698524475098,
        0.6122556328773499,
        0.6409817337989807,
        0.6650606393814087,
        0.6922379732131958,
        0.7036148905754089,
        0.7408556938171387,
        0.748346745967865,
        0.7508751153945923,
        0.7764557600021362,
        0.777652233839035,
        0.777652233839035,
        0.7779557108879089
      ],
      "expected": {
        "calibrated_mae": 0.133813
      }
    },
    {
      "context_key": "hard:budget-p2:survival:10000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4786259134610494,
        0.4786259134610494,
        0.4786259134610494,
        0.5232529640197754,
        0.5356149077415466,
        0.5536400675773621,
        0.5795424580574036,
        0.6037540435791016,
        0.6329393982887268,
        0.6657827496528625,
        0.6930865049362183,
        0.7222453355789185,
        0.7348325848579407,
        0.7722459435462952,
        0.7793842554092407,
        0.7822379469871521,
        0.806327760219574,
        0.8075140416622162,
        0.8075140416622162,
        0.8078972697257996
      ],
      "expected": {
        "calibrated_mae": 0.121745
      }
    },
    {
      "context_key": "hard:budget-p2:survival:10000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.48411107063293457,
        0.48411107063293457,
        0.48411107063293457,
        0.5292884707450867,
        0.5418838262557983,
        0.5596276521682739,
        0.5854324698448181,
        0.6091379523277283,
        0.6379200220108032,
        0.6699861288070679,
        0.6970197558403015,
        0.7256535291671753,
        0.7379354238510132,
        0.7747617959976196,
        0.7819472551345825,
        0.7849122285842896,
        0.8083086609840393,
        0.8096820414066315,
        0.8096820414066315,
        0.8100157380104065
      ],
      "expected": {
        "calibrated_mae": 0.122754
      }
    },
    {
      "context_key": "hard:budget-p2:survival:10000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4764651556809743,
        0.4764651556809743,
        0.4764651556809743,
        0.5228342413902283,
        0.5356497168540955,
        0.5538663864135742,
        0.580463707447052,
        0.6049479842185974,
        0.6345733404159546,
        0.6676878929138184,
        0.6953552961349487,
        0.724770724773407,
        0.7372192144393921,
        0.7745137810707092,
        0.7817829251289368,
        0.7847555875778198,
        0.8084489107131958,
        0.8097670376300812,
        0.8097670376300812,
        0.8100575804710388
      ],
      "expected": {
        "calibrated_mae": 0.120348
      }
    },
    {
      "context_key": "hard:budget-p2:survival:10000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 10000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.47557329138120014,
        0.47557329138120014,
        0.47557329138120014,
        0.519966721534729,
        0.5323163866996765,
        0.5501711964607239,
        0.5758894085884094,
        0.6000449657440186,
        0.629224419593811,
        0.6620553731918335,
        0.6895381212234497,
        0.7191014885902405,
        0.7318962216377258,
        0.7702956199645996,
        0.7776816487312317,
        0.7806576490402222,
        0.8052986860275269,
        0.8065676987171173,
        0.8065676987171173,
        0.8070088624954224
      ],
      "expected": {
        "calibrated_mae": 0.121351
      }
    },
    {
      "context_key": "hard:budget-p2:survival:25000:onboarding",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "onboarding"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46424753467241925,
        0.46424753467241925,
        0.46424753467241925,
        0.51031494140625,
        0.5232011079788208,
        0.5420955419540405,
        0.5688470005989075,
        0.5950502753257751,
        0.626507580280304,
        0.6631243228912354,
        0.6940193176269531,
        0.7266406416893005,
        0.741571843624115,
        0.7845984697341919,
        0.7928256988525391,
        0.7959878444671631,
        0.8228480219841003,
        0.8240025639533997,
        0.8240025639533997,
        0.8242872357368469
      ],
      "expected": {
        "calibrated_mae": 0.11071
      }
    },
    {
      "context_key": "hard:budget-p2:survival:25000:growth",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "growth"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4717949827512105,
        0.4717949827512105,
        0.4717949827512105,
        0.5185316801071167,
        0.5317838788032532,
        0.5504831671714783,
        0.5772707462310791,
        0.6030532717704773,
        0.6341870427131653,
        0.6699334383010864,
        0.700381338596344,
        0.7321460843086243,
        0.7465975880622864,
        0.788253128528595,
        0.7963011860847473,
        0.7995023131370544,
        0.8251396417617798,
        0.8264293372631073,
        0.8264293372631073,
        0.8266412019729614
      ],
      "expected": {
        "calibrated_mae": 0.112115
      }
    },
    {
      "context_key": "hard:budget-p2:survival:25000:mature",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "mature"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.46449490388234455,
        0.46449490388234455,
        0.46449490388234455,
        0.5119287371635437,
        0.5252799391746521,
        0.5443108677864075,
        0.571631908416748,
        0.5980795621871948,
        0.6300145983695984,
        0.6668874025344849,
        0.6981147527694702,
        0.7308959364891052,
        0.7456250190734863,
        0.7882275581359863,
        0.7964901328086853,
        0.7997393012046814,
        0.8259408473968506,
        0.8271647989749908,
        0.8271647989749908,
        0.8273378014564514
      ],
      "expected": {
        "calibrated_mae": 0.109525
      }
    },
    {
      "context_key": "hard:budget-p2:survival:25000:plateau",
      "context": {
        "difficulty": "hard",
        "generator": "budget-p2",
        "bot_policy": "survival",
        "pb_bin": 25000,
        "lifecycle_stage": "plateau"
      },
      "theta": {
        "personalizationStrength": 0.115,
        "temperature": 0.055,
        "surpriseBudgetGain": 0.07500000000000001,
        "surpriseCooldown": 7.0,
        "maxEvaluatedTriplets": 80.0,
        "pbTensionCenter": 0.81,
        "pbTensionWidth": 0.095,
        "pbBrakeCenter": 1.065,
        "pbBrakeWidth": 0.075
      },
      "predicted_curve": [
        0.4637160400549571,
        0.4637160400549571,
        0.4637160400549571,
        0.5095664262771606,
        0.5225831866264343,
        0.5414374470710754,
        0.5681217312812805,
        0.5944209098815918,
        0.6258923411369324,
        0.6624274849891663,
        0.6932821869850159,
        0.7258670330047607,
        0.7408654689788818,
        0.7842027544975281,
        0.7925145626068115,
        0.7956475615501404,
        0.8227230906486511,
        0.8239089548587799,
        0.8239089548587799,
        0.8242198824882507
      ],
      "expected": {
        "calibrated_mae": 0.110648
      }
    }
  ]
};
