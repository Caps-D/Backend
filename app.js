require('dotenv').config();
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const generateToken = (user) => {
    return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' }); // 토큰 유효기간 7일
};
const cors = require('cors');
const cron = require('node-cron');
const app = express();
const port = 3000;
const pool = require('./db'); // MySQL 연결 파일 가져오기
const cookieParser = require('cookie-parser');

app.use(cors({
    origin: ['https://h4capston.site', 'http://localhost:5173'],
    credentials: true,
}));

app.use(cookieParser());
app.use(express.json());

// app.use(async (req, res, next) => {
//     const userId = req.user.id; // 사용자 ID
    
//     const connection = await pool.getConnection();
//     try {
//         // 사용자 정보 가져오기
//         const [userRows] = await connection.query(
//             `SELECT level, state FROM user_data WHERE user_id = ?`,
//             [userId]
//         );

//         if (userRows.length === 0) {
//             return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
//         }

//         const user = userRows[0];
//         let newState = user.state;

//         // 레벨에 따라 state 자동 업데이트
//         if (user.level >= 7 && user.state !== 4) {
//             newState = 4; // 레벨 7 이상이면 state는 4
//         } else if (user.level >= 5 && user.state !== 3) {
//             newState = 3; // 레벨 5 이상이면 state는 3
//         } else if (user.level >= 3 && user.state !== 2) {
//             newState = 2; // 레벨 3 이상이면 state는 2
//         }

//         // state가 변경되었으면 업데이트
//         if (newState !== user.state) {
//             await connection.query(
//                 `UPDATE user_data SET state = ? WHERE user_id = ?`,
//                 [newState, userId]
//             );
//         }

//         next(); // 요청이 진행되도록 next() 호출
//     } catch (error) {
//         console.error('자동 state 업데이트 오류:', error);
//         res.status(500).json({ error: '서버 오류' });
//     } finally {
//         connection.release(); // DB 연결 종료
//     }
// });

// app.use(async (req, res, next) => {
//     const userId = req.user.id;  // 인증된 사용자의 ID

//     const connection = await pool.getConnection();
//     try {
//         // 사용자의 경험치와 현재 레벨 정보 가져오기
//         const [userRows] = await connection.query(
//             `SELECT experience, level FROM user_data WHERE user_id = ?`,
//             [userId]
//         );

//         if (userRows.length === 0) {
//             return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
//         }

//         const user = userRows[0];
//         let newLevel = user.level;

//         // 경험치에 따른 레벨 계산 (100 경험치 단위로 레벨 증가)
//         if (user.experience >= 1000 && user.level < 10) {
//             newLevel = 10;
//         } else if (user.experience >= 900 && user.level < 9) {
//             newLevel = 9;
//         } else if (user.experience >= 800 && user.level < 8) {
//             newLevel = 8;
//         } else if (user.experience >= 700 && user.level < 7) {
//             newLevel = 7;
//         } else if (user.experience >= 600 && user.level < 6) {
//             newLevel = 6;
//         } else if (user.experience >= 500 && user.level < 5) {
//             newLevel = 5;
//         } else if (user.experience >= 400 && user.level < 4) {
//             newLevel = 4;
//         } else if (user.experience >= 300 && user.level < 3) {
//             newLevel = 3;
//         } else if (user.experience >= 200 && user.level < 2) {
//             newLevel = 2;
//         } else if (user.experience >= 100 && user.level < 1) {
//             newLevel = 1;
//         }

//         // 레벨이 변경되었다면 업데이트
//         if (newLevel !== user.level) {
//             await connection.query(
//                 `UPDATE user_data SET level = ? WHERE user_id = ?`,
//                 [newLevel, userId]
//             );
//         }

//         next(); // 요청이 진행되도록 next() 호출
//     } catch (error) {
//         console.error('레벨 자동 업데이트 오류:', error);
//         res.status(500).json({ error: '서버 오류' });
//     } finally {
//         connection.release(); // DB 연결 종료
//     }
// });

app.get('/', (req, res) => {
    res.send("hi, we're h4!");
});

app.get('/auth/kakao', (req, res) => {
    const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${process.env.KAKAO_CLIENT_ID}&redirect_uri=${process.env.KAKAO_REDIRECT_URI}&response_type=code`;
    res.redirect(kakaoAuthUrl);
});

/**
 * 2. 카카오 로그인 후, 인가 코드(code)를 받아 백엔드에서 처리
 */
app.get('/auth/kakao/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ error: '인가 코드가 없습니다.' });
    }

    try {
        const tokenResponse = await axios.post('https://kauth.kakao.com/oauth/token', null, {
            params: {
                grant_type: 'authorization_code',
                client_id: process.env.KAKAO_CLIENT_ID,
                client_secret: process.env.KAKAO_CLIENT_SECRET,
                redirect_uri: process.env.KAKAO_REDIRECT_URI,
                code,
            },
        });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://kapi.kakao.com/v2/user/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const user = {
            id: userResponse.data.id.toString(),
            email: userResponse.data.kakao_account.email || null,
            nickname: userResponse.data.kakao_account.profile.nickname,
            provider: 'kakao',
        };

        const connection = await pool.getConnection();
        let redirectPath = '/main';
        try {
            let [existingUser] = await connection.query(
                `SELECT * FROM users WHERE email = ?`,
                [user.email]
            );

            if (existingUser.length === 0) {
                [existingUser] = await connection.query(
                    `SELECT * FROM users WHERE id = ?`,
                    [user.id]
                );
            }

            if (existingUser.length === 0) {
                // 신규 회원 가입
                await connection.query(
                    `INSERT INTO users (id, email, nickname, provider) VALUES (?, ?, ?, ?)`,
                    [user.id, user.email, user.nickname, user.provider]
                );

                // 기본 운동 목표와 함께 user_data 및 daily_quests 초기화
                await connection.query(
                    `INSERT INTO user_data (user_id, level, coin, targetExercise, targetcount, targetSet, targetCheck, gender, top, pants, state, experience, challenge_level)
                     VALUES (?, 1, 500, 0, 0, 0, 0, NULL, NULL, NULL, 1, 100, 1)`, // 경험치 기본값 100, challenge_level 기본값 1
                    [user.id]
                );

                // 도전과제(누적형) 초기화
                await connection.query(
                    `INSERT INTO challenge_quests (user_id, level) VALUES (?, 1)`, // 기본 challenge_level 1
                    [user.id]
                );

                // 기본 퀘스트 목표 설정 (레벨 1 기준)
                const levelGoals = [
                    { level: 1, squat: 7, plank: 30, pushup: 5 },
                    { level: 2, squat: 8, plank: 35, pushup: 6 },
                    { level: 3, squat: 9, plank: 40, pushup: 7 },
                    { level: 4, squat: 10, plank: 45, pushup: 8 },
                    { level: 5, squat: 11, plank: 50, pushup: 9 },
                    { level: 6, squat: 12, plank: 55, pushup: 10 },
                    { level: 7, squat: 13, plank: 60, pushup: 11 },
                    { level: 8, squat: 14, plank: 65, pushup: 12 },
                    { level: 9, squat: 15, plank: 70, pushup: 13 },
                    { level: 10, squat: 16, plank: 70, pushup: 14 }
                ];

                for (let i = 0; i < levelGoals.length; i++) {
                    const goals = levelGoals[i];
                    await connection.query(
                        `INSERT INTO daily_quests (user_id, exercise_type, level, goal_count, experience, coin, is_success)
                         VALUES 
                            (?, 'squat', ?, ?, 35, 20, FALSE),
                            (?, 'plank', ?, ?, 35, 20, FALSE),
                            (?, 'pushup', ?, ?, 35, 20, FALSE)`,
                        [
                            user.id, goals.level, goals.squat, // first entry: squat
                            user.id, goals.level, goals.plank, // second entry: situp
                            user.id, goals.level, goals.pushup // third entry: pushup
                        ]
                    );
                }

                // 도전 과제 초기화 (누적형 목표)
                const levelGoals_challenge = [
                    { level: 1, squat: 50, plank: 50, pushup: 30 },
                    { level: 2, squat: 55, plank: 55, pushup: 35 },
                    { level: 3, squat: 60, plank: 60, pushup: 40 },
                    { level: 4, squat: 65, plank: 65, pushup: 45 },
                    { level: 5, squat: 70, plank: 70, pushup: 50 },
                    { level: 6, squat: 75, plank: 75, pushup: 55 },
                    { level: 7, squat: 80, plank: 80, pushup: 60 },
                    { level: 8, squat: 85, plank: 85, pushup: 65 },
                    { level: 9, squat: 90, plank: 90, pushup: 70 },
                    { level: 10, squat: 95, plank: 95, pushup: 75 }
                ];

                for (let i = 0; i < levelGoals_challenge.length; i++) {
                    const goals = levelGoals_challenge[i];
                    await connection.query(
                        `INSERT INTO challenge_quests (user_id, level, exercise_type, goal_count, is_success, coin, exp)
                         VALUES 
                            (?, ?, 'squat', ?, 0, 500, 100),
                            (?, ?, 'plank', ?, 0, 500, 100),
                            (?, ?, 'pushup', ?, 0, 500, 100)`,
                        [
                            user.id, goals.level, goals.squat,  // 첫 번째 항목: squat
                            user.id, goals.level, goals.plank,  // 두 번째 항목: plank
                            user.id, goals.level, goals.pushup  // 세 번째 항목: pushup
                        ]
                    );
                }
                
                // `outer` 아이템을 `wardrobe`에 추가
                const outerItems = [
                    { item_id: 1, item_type: 'outer', item_name: 'outer1' },
                    { item_id: 2, item_type: 'outer', item_name: 'outer2' },
                    { item_id: 3, item_type: 'outer', item_name: 'outer3' },
                    { item_id: 4, item_type: 'outer', item_name: 'outer4' },
                    { item_id: 5, item_type: 'outer', item_name: 'outer5' },
                    { item_id: 6, item_type: 'outer', item_name: 'outer6' }
                ];

                for (const item of outerItems) {
                    await connection.query(
                        `INSERT INTO wardrobe (user_id, item_id, item_type, item_name, equipped) 
                        VALUES (?, ?, ?, ?, 0)`,
                        [user.id, item.item_id, item.item_type, item.item_name]  // equipped는 기본적으로 0 (착용 안 함)
                    );
                }

                redirectPath = '/signup';
            } else {
                // 기존 사용자라면 정보 업데이트
                await connection.query(
                    `UPDATE users SET email = ?, nickname = ? WHERE id = ?`,
                    [user.email, user.nickname, user.id]
                );
            }
        } finally {
            connection.release();
        }

        const token = generateToken({ id: user.id });
        console.log(token);
        res.cookie('token', token, {
            secure: true,
            sameSite: 'None',
        });

        res.redirect(`https://h4capston.site${redirectPath}`);
        //res.redirect(`http://localhost:5173${redirectPath}`);
    } catch (error) {
        console.error("카카오 로그인 오류:", error);
        res.status(400).json({ error: '카카오 로그인 실패' });
    }
});


app.get('/auth/naver', (req, res) => {
    const state = Math.random().toString(36).substring(2, 15); // CSRF 방지를 위한 상태 값
    const naverAuthUrl = `https://nid.naver.com/oauth2.0/authorize?client_id=${process.env.NAVER_CLIENT_ID}&redirect_uri=${process.env.NAVER_REDIRECT_URI}&response_type=code&state=${state}`;
    res.redirect(naverAuthUrl);
});


// **네이버 로그인**
app.get('/auth/naver/callback', async (req, res) => {
    const { code, state } = req.query;
    try {
        const tokenResponse = await axios.post('https://nid.naver.com/oauth2.0/token', null, {
            params: {
                grant_type: 'authorization_code',
                client_id: process.env.NAVER_CLIENT_ID,
                client_secret: process.env.NAVER_CLIENT_SECRET,
                redirect_uri: process.env.NAVER_REDIRECT_URI,
                code,
                state,
            },
        });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://openapi.naver.com/v1/nid/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const user = {
            id: userResponse.data.response.id,
            email: userResponse.data.response.email || null,
            nickname: userResponse.data.response.nickname,
            provider: 'naver',
        };

        const connection = await pool.getConnection();
        let redirectPath = '/main';
        try {
            let [existingUser] = await connection.query(
                `SELECT * FROM users WHERE email = ?`,
                [user.email]
            );

            if (existingUser.length === 0) {
                [existingUser] = await connection.query(
                    `SELECT * FROM users WHERE id = ?`,
                    [user.id]
                );
            }

            if (existingUser.length === 0) {
                // 신규 회원 가입
                await connection.query(
                    `INSERT INTO users (id, email, nickname, provider) VALUES (?, ?, ?, ?)`,
                    [user.id, user.email, user.nickname, user.provider]
                );

                // 기본 운동 목표와 함께 user_data 및 daily_quests 초기화
                await connection.query(
                    `INSERT INTO user_data (user_id, level, coin, targetExercise, targetcount, targetSet, targetCheck, gender, top, pants, state, experience, challenge_level)
                     VALUES (?, 1, 500, 0, 0, 0, 0, NULL, NULL, NULL, 1, 100, 1)`, // 경험치 기본값 100, challenge_level 기본값 1
                    [user.id]
                );

            

                // 기본 퀘스트 목표 설정 (레벨 1 기준)
                const levelGoals = [
                    { level: 1, squat: 7, plank: 30, pushup: 5 },
                    { level: 2, squat: 8, plank: 35, pushup: 6 },
                    { level: 3, squat: 9, plank: 40, pushup: 7 },
                    { level: 4, squat: 10, plank: 45, pushup: 8 },
                    { level: 5, squat: 11, plank: 50, pushup: 9 },
                    { level: 6, squat: 12, plank: 55, pushup: 10 },
                    { level: 7, squat: 13, plank: 60, pushup: 11 },
                    { level: 8, squat: 14, plank: 65, pushup: 12 },
                    { level: 9, squat: 15, plank: 70, pushup: 13 },
                    { level: 10, squat: 16, plank: 70, pushup: 14 }
                ];

                for (let i = 0; i < levelGoals.length; i++) {
                    const goals = levelGoals[i];
                    await connection.query(
                        `INSERT INTO daily_quests (user_id, exercise_type, level, goal_count, experience, coin, is_success)
                         VALUES 
                            (?, 'squat', ?, ?, 35, 20, FALSE),
                            (?, 'plank', ?, ?, 35, 20, FALSE),
                            (?, 'pushup', ?, ?, 35, 20, FALSE)`,
                        [
                            user.id, goals.level, goals.squat, // first entry: squat
                            user.id, goals.level, goals.plank, // second entry: situp
                            user.id, goals.level, goals.pushup // third entry: pushup
                        ]
                    );
                }

                // 도전 과제 초기화 (누적형 목표)
                const levelGoals_challenge = [
                    { level: 1, squat: 50, plank: 50, pushup: 30 },
                    { level: 2, squat: 55, plank: 55, pushup: 35 },
                    { level: 3, squat: 60, plank: 60, pushup: 40 },
                    { level: 4, squat: 65, plank: 65, pushup: 45 },
                    { level: 5, squat: 70, plank: 70, pushup: 50 },
                    { level: 6, squat: 75, plank: 75, pushup: 55 },
                    { level: 7, squat: 80, plank: 80, pushup: 60 },
                    { level: 8, squat: 85, plank: 85, pushup: 65 },
                    { level: 9, squat: 90, plank: 90, pushup: 70 },
                    { level: 10, squat: 95, plank: 95, pushup: 75 }
                ];

                for (let i = 0; i < levelGoals_challenge.length; i++) {
                    const goals = levelGoals_challenge[i];
                    await connection.query(
                        `INSERT INTO challenge_quests (user_id, level, exercise_type, goal_count, is_success, coin, exp)
                         VALUES 
                            (?, ?, 'squat', ?, 0, 500, 100),
                            (?, ?, 'plank', ?, 0, 500, 100),
                            (?, ?, 'pushup', ?, 0, 500, 100)`,
                        [
                            user.id, goals.level, goals.squat,  // 첫 번째 항목: squat
                            user.id, goals.level, goals.plank,  // 두 번째 항목: plank
                            user.id, goals.level, goals.pushup  // 세 번째 항목: pushup
                        ]
                    );
                }
                
                // `outer` 아이템을 `wardrobe`에 추가
                const outerItems = [
                    { item_id: 1, item_type: 'outer', item_name: 'outer1' },
                    { item_id: 2, item_type: 'outer', item_name: 'outer2' },
                    { item_id: 3, item_type: 'outer', item_name: 'outer3' },
                    { item_id: 4, item_type: 'outer', item_name: 'outer4' },
                    { item_id: 5, item_type: 'outer', item_name: 'outer5' },
                    { item_id: 6, item_type: 'outer', item_name: 'outer6' }
                ];

                for (const item of outerItems) {
                    await connection.query(
                        `INSERT INTO wardrobe (user_id, item_id, item_type, item_name, equipped) 
                        VALUES (?, ?, ?, ?, 0)`,
                        [user.id, item.item_id, item.item_type, item.item_name]  // equipped는 기본적으로 0 (착용 안 함)
                    );
                }

                redirectPath = '/signup';
            } else {
                // 기존 사용자라면 정보 업데이트
                await connection.query(
                    `UPDATE users SET email = ?, nickname = ? WHERE id = ?`,
                    [user.email, user.nickname, user.id]
                );
            }
        } finally {
            connection.release();
        }

        const token = generateToken({ id: user.id });

        res.cookie('token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.redirect(`https://h4capston.site${redirectPath}`);
        //res.redirect(`http://localhost:5173${redirectPath}`);
    } catch (error) {
        console.error('네이버 로그인 오류:', error);
        res.status(400).json({ error: '네이버 로그인 실패' });
    }
});



app.get('/auth/google', (req, res) => {
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${process.env.GOOGLE_REDIRECT_URI}&response_type=code&scope=email%20profile`;
    res.redirect(googleAuthUrl);
});


// **구글 로그인**
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ error: '인가 코드가 없습니다.' });
    }

    try {
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
                grant_type: 'authorization_code',
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: process.env.GOOGLE_REDIRECT_URI,
                code,
            },
        });

        const accessToken = tokenResponse.data.access_token;
        const userResponse = await axios.get('https://www.googleapis.com/oauth2/v1/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const user = {
            id: userResponse.data.id,
            email: userResponse.data.email || null,
            nickname: userResponse.data.name,
            provider: 'google',
        };

        const connection = await pool.getConnection();
        let redirectPath = '/main';
        try {
            let [existingUser] = await connection.query(
                `SELECT * FROM users WHERE email = ?`,
                [user.email]
            );

            if (existingUser.length === 0) {
                [existingUser] = await connection.query(
                    `SELECT * FROM users WHERE id = ?`,
                    [user.id]
                );
            }

            if (existingUser.length === 0) {
                // 신규 회원 가입
                await connection.query(
                    `INSERT INTO users (id, email, nickname, provider) VALUES (?, ?, ?, ?)`,
                    [user.id, user.email, user.nickname, user.provider]
                );

                // 기본 운동 목표와 함께 user_data 및 daily_quests 초기화
                await connection.query(
                    `INSERT INTO user_data (user_id, level, coin, targetExercise, targetcount, targetSet, targetCheck, gender, top, pants, state, experience, challenge_level)
                     VALUES (?, 1, 500, 0, 0, 0, 0, NULL, NULL, NULL, 1, 100, 1)`, // 경험치 기본값 100, challenge_level 기본값 1
                    [user.id]
                );

                // 도전과제(누적형) 초기화
                await connection.query(
                    `INSERT INTO challenge_quests (user_id, level) VALUES (?, 1)`, // 기본 challenge_level 1
                    [user.id]
                );

                // 기본 퀘스트 목표 설정 (레벨 1 기준)
                const levelGoals = [
                    { level: 1, squat: 7, plank: 30, pushup: 5 },
                    { level: 2, squat: 8, plank: 35, pushup: 6 },
                    { level: 3, squat: 9, plank: 40, pushup: 7 },
                    { level: 4, squat: 10, plank: 45, pushup: 8 },
                    { level: 5, squat: 11, plank: 50, pushup: 9 },
                    { level: 6, squat: 12, plank: 55, pushup: 10 },
                    { level: 7, squat: 13, plank: 60, pushup: 11 },
                    { level: 8, squat: 14, plank: 65, pushup: 12 },
                    { level: 9, squat: 15, plank: 70, pushup: 13 },
                    { level: 10, squat: 16, plank: 70, pushup: 14 }
                ];

                for (let i = 0; i < levelGoals.length; i++) {
                    const goals = levelGoals[i];
                    await connection.query(
                        `INSERT INTO daily_quests (user_id, exercise_type, level, goal_count, experience, coin, is_success)
                         VALUES 
                            (?, 'squat', ?, ?, 35, 20, FALSE),
                            (?, 'plank', ?, ?, 35, 20, FALSE),
                            (?, 'pushup', ?, ?, 35, 20, FALSE)`,
                        [
                            user.id, goals.level, goals.squat, // first entry: squat
                            user.id, goals.level, goals.plank, // second entry: situp
                            user.id, goals.level, goals.pushup // third entry: pushup
                        ]
                    );
                }

                // 도전 과제 초기화 (누적형 목표)
                const levelGoals_challenge = [
                    { level: 1, squat: 50, plank: 50, pushup: 30 },
                    { level: 2, squat: 55, plank: 55, pushup: 35 },
                    { level: 3, squat: 60, plank: 60, pushup: 40 },
                    { level: 4, squat: 65, plank: 65, pushup: 45 },
                    { level: 5, squat: 70, plank: 70, pushup: 50 },
                    { level: 6, squat: 75, plank: 75, pushup: 55 },
                    { level: 7, squat: 80, plank: 80, pushup: 60 },
                    { level: 8, squat: 85, plank: 85, pushup: 65 },
                    { level: 9, squat: 90, plank: 90, pushup: 70 },
                    { level: 10, squat: 95, plank: 95, pushup: 75 }
                ];

                for (let i = 0; i < levelGoals_challenge.length; i++) {
                    const goals = levelGoals_challenge[i];
                    await connection.query(
                        `INSERT INTO challenge_quests (user_id, level, exercise_type, goal_count, is_success, coin, exp)
                         VALUES 
                            (?, ?, 'squat', ?, 0, 500, 100),
                            (?, ?, 'plank', ?, 0, 500, 100),
                            (?, ?, 'pushup', ?, 0, 500, 100)`,
                        [
                            user.id, goals.level, goals.squat,  // 첫 번째 항목: squat
                            user.id, goals.level, goals.plank,  // 두 번째 항목: plank
                            user.id, goals.level, goals.pushup  // 세 번째 항목: pushup
                        ]
                    );
                }
                
                // `outer` 아이템을 `wardrobe`에 추가
                const outerItems = [
                    { item_id: 1, item_type: 'outer', item_name: 'outer1' },
                    { item_id: 2, item_type: 'outer', item_name: 'outer2' },
                    { item_id: 3, item_type: 'outer', item_name: 'outer3' },
                    { item_id: 4, item_type: 'outer', item_name: 'outer4' },
                    { item_id: 5, item_type: 'outer', item_name: 'outer5' },
                    { item_id: 6, item_type: 'outer', item_name: 'outer6' }
                ];

                for (const item of outerItems) {
                    await connection.query(
                        `INSERT INTO wardrobe (user_id, item_id, item_type, item_name, equipped) 
                        VALUES (?, ?, ?, ?, 0)`,
                        [user.id, item.item_id, item.item_type, item.item_name]  // equipped는 기본적으로 0 (착용 안 함)
                    );
                }

                redirectPath = '/signup';
            } else {
                // 기존 사용자라면 정보 업데이트
                await connection.query(
                    `UPDATE users SET email = ?, nickname = ? WHERE id = ?`,
                    [user.email, user.nickname, user.id]
                );
            }
        } finally {
            connection.release();
        }

        const token = generateToken({ id: user.id });

        res.cookie('token', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
        });

        res.redirect(`https://h4capston.site${redirectPath}`);

    } catch (error) {
        console.error("구글 로그인 오류:", error);
        res.status(400).json({ error: '구글 로그인 실패' });
    }
});



// MainData = {
//     level: number;
//     coin: number;
//     targetExercise: string;
//     targetcount: number;
//     targetSet: number;
//     targetCheck: number;
//     character: {
//         gender: string;
//         top: string | null;
//         pants: string | null;
//         state: number | null;
//     };
// };


const authenticate = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: '인증 토큰이 X' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    }
};


function getExerciseKoreanName(type) {
    const map = {
        squat: "스쿼트",
        pushup: "팔굽혀펴기",
        plank: "플랭크"
    };
    return map[type] || type;
}


app.get('/main', authenticate, async (req, res) => {
    const userId = req.user.id;
    const connection = await pool.getConnection();
    console.log(userId);
    try {
        // 1. 사용자 정보 조회 (레벨 포함)
        const [userRows] = await connection.query(`
            SELECT experience, coin, level, targetExercise, targetcount, targetSet, targetCheck,
                   gender, top, pants, state
            FROM user_data
            WHERE user_id = ?
        `, [userId]);

        if (userRows.length === 0) {
            return res.status(404).json({ error: '사용자 데이터를 찾을 수 없습니다.' });
        }

        const userData = userRows[0];

        // 2. 오늘 날짜 기반 운동 종목 결정
        const today = new Date();
        const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
        const exerciseTypes = ['squat', 'pushup', 'plank'];
        const exerciseType = `squat` //exerciseTypes[dayOfYear % 3];

        // 3. daily_quests에서 해당 유저의 오늘 할당된 퀘스트 정보 가져오기 (level 기준)
        const [questRows] = await connection.query(`
            SELECT * FROM daily_quests
            WHERE user_id = ? AND exercise_type = ? AND level = ?
        `, [userId, 'squat', userData.level]);

        let todayQuest = null;

        if (questRows.length > 0) {
            const quest = questRows[0];
            todayQuest = {
                date: today.toISOString().split('T')[0],
                exercise_type: exerciseType,
                name: getExerciseName(exerciseType),
                icon: getExerciseIcon(exerciseType),
                count: quest.goal_count,
                sets: quest.sets,
                completed: quest.completed_sets >= quest.goal_count,
                reward: quest.coin,
                exp: quest.experience
            };

            // 4. 유저 테이블에 오늘의 퀘스트 상태 업데이트
            await connection.query(`
                UPDATE user_data
                SET targetExercise = ?, targetcount = ?, targetSet = ?, targetCheck = ?
                WHERE user_id = ?
            `, [exerciseType, quest.goal_count, quest.sets, quest.completed_sets, userId]);
        }

        // 5. 반환 데이터 구성
        // 5. 반환 데이터 구성
        function formatClothing(typeValue, type) {
            if (!typeValue) return null;
            const match = typeValue.match(/\d+/);
            if (!match) return null;
            const number = match[0];
            return type === 'top' ? `top[${number}]` : `pants[${number}]`;
        }

        const MainData = {
            level: userData.experience,
            coin: userData.coin,
            targetExercise: getExerciseKoreanName(userData.targetExercise),
            targetcount: userData.targetcount,
            targetSet: userData.targetSet,
            targetCheck: userData.targetCheck,
            character: {
                gender: userData.gender,
                top: formatClothing(userData.top, 'top'),
                pants: formatClothing(userData.pants, 'pants'),
                state: userData.state
            },
            todayQuest: todayQuest
        };


        res.json(MainData);
    } catch (error) {
        console.error("메인 데이터 조회 오류:", error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});

//친구 검색
app.post('/search-user', authenticate, async (req, res) => {
    const { nickname } = req.body;

    if (!nickname || nickname.trim() === '') {
        return res.status(400).json({ error: '닉네임을 입력해주세요.' });
    }

    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query(`
            SELECT u.id AS user_id, u.nickname, ud.level
            FROM users u
            JOIN user_data ud ON u.id = ud.user_id
            WHERE u.nickname LIKE ?
            LIMIT 20
        `, [`%${nickname}%`]);

        res.json(rows);
    } catch (error) {
        console.error('닉네임 검색 오류:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    } finally {
        connection.release();
    }
});

// 친구 추가
app.post('/addFriend', authenticate, async (req, res) => {
    const { friendNickname } = req.body;
    const userId = req.user.id; // 현재 로그인한 사용자 ID

    if (!friendNickname) {
        return res.status(400).json({ error: '친구 닉네임을 입력하세요.' });
    }

    const connection = await pool.getConnection();
    try {
        // 1️⃣ 친구의 user_id 찾기
        const [friendData] = await connection.query(
            `SELECT id, nickname FROM users WHERE nickname = ?`,
            [friendNickname]
        );

        if (friendData.length === 0) {
            return res.status(404).json({ error: '해당 닉네임을 가진 사용자가 없습니다.' });
        }

        const friendId = friendData[0].id;
        const friendNick = friendData[0].nickname;

        const [existingFriend] = await connection.query(
            `SELECT * FROM friends WHERE user_id = ? AND friend_id = ?`,
            [userId, friendId]
        );

        if (existingFriend.length > 0) {
            return res.status(400).json({ error: '이미 친구로 추가된 사용자입니다.' });
        }

        await connection.query(
            `INSERT INTO friends (user_id, friend_id, friend_nickname) VALUES (?, ?, ?)`,
            [userId, friendId, friendNick]
        );

        res.json({ message: '친구 추가 성공', friend: friendNick });

    } catch (error) {
        console.error('친구 추가 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});

// 친구 목록 가져오기
app.get('/friends', authenticate, async (req, res) => {
    const userId = req.user.id;

    const connection = await pool.getConnection();
    try {
        // 내가 추가한 친구 목록 조회
        const [friendsList] = await connection.query(
            `SELECT u.nickname, ud.level
             FROM friends f
             JOIN users u ON f.friend_id = u.id
             JOIN user_data ud ON ud.user_id = u.id
             WHERE f.user_id = ?`,
            [userId]
        );

        // 나를 친구로 추가한 사람들 조회
        const [friendsAddedMe] = await connection.query(
            `SELECT u.nickname, ud.level
             FROM friends f
             JOIN users u ON f.user_id = u.id
             JOIN user_data ud ON ud.user_id = u.id
             WHERE f.friend_id = ?`,
            [userId]
        );

        // 닉네임 + 레벨 중복 제거
        const allFriends = [...friendsList, ...friendsAddedMe].filter(
            (friend, index, self) =>
                index === self.findIndex((f) => f.nickname === friend.nickname)
        );

        res.json({ friends: allFriends });

    } catch (error) {
        console.error('친구 목록 조회 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});



// 친구 삭제
app.delete('/removeFriend', authenticate, async (req, res) => {
    const { friendNickname } = req.body;
    const userId = req.user.id;

    if (!friendNickname) {
        return res.status(400).json({ error: '삭제할 친구의 닉네임을 입력하세요.' });
    }

    const connection = await pool.getConnection();
    try {
        const [friendData] = await connection.query(
            `SELECT id FROM users WHERE nickname = ?`,
            [friendNickname]
        );

        if (friendData.length === 0) {
            return res.status(404).json({ error: '해당 닉네임을 가진 사용자가 없습니다.' });
        }

        const friendId = friendData[0].id;

        // 2️⃣ 친구 관계 삭제 (내가 추가한 친구 or 상대가 나를 추가한 경우)
        const [deleteResult] = await connection.query(
            `DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
            [userId, friendId, friendId, userId]
        );

        if (deleteResult.affectedRows === 0) {
            return res.status(400).json({ error: '해당 사용자는 친구 목록에 없습니다.' });
        }

        res.json({ message: '친구 삭제 성공', friend: friendNickname });

    } catch (error) {
        console.error('친구 삭제 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});

// 성별추가
app.post('/signup', authenticate, async (req, res) => {
    const userId = req.user.id;
    const { gender, nickname } = req.body;

    // ✅ 유효성 검사
    if (!gender || !['male', 'female', 'unknown'].includes(gender)) {
        return res.status(400).json({ error: '유효한 성별을 입력하세요. (male, female, unknown)' });
    }

    if (!nickname || nickname.trim().length < 1) {
        return res.status(400).json({ error: '닉네임을 입력하세요.' });
    }

    const connection = await pool.getConnection();
    try {
        // ✅ 닉네임 중복 검사 (본인 제외)
        const [duplicateCheck] = await connection.query(
            `SELECT id FROM users WHERE nickname = ? AND id != ?`,
            [nickname, userId]
        );

        if (duplicateCheck.length > 0) {
            return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });
        }

        // ✅ 닉네임 및 성별 업데이트
        const [result] = await connection.query(
            `UPDATE users SET gender = ?, nickname = ? WHERE id = ?`,
            [gender, nickname, userId]
        );
        const [result2] = await connection.query(
            `UPDATE user_data SET gender = ? WHERE user_id = ?`,
            [gender, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: '해당 사용자를 찾을 수 없습니다.' });
        }

        res.json({ message: '성별 및 닉네임이 업데이트되었습니다.', gender, nickname });
    } catch (error) {
        console.error('성별/닉네임 업데이트 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});



// 운동 종류에 맞는 이름을 반환하는 함수
function getExerciseName(exerciseType) {
    switch (exerciseType) {
        case 'squat':
            return '스쿼트';
        case 'plank':
            return '플랭크';
        case 'pushup':
            return '팔굽혀펴기';
        default:
            return '';
    }
}

// 운동 종류에 맞는 아이콘을 반환하는 함수
function getExerciseIcon(exerciseType) {
    switch (exerciseType) {
        case 'squat':
            return '스쿼트';
        case 'plank':
            return '플랭크';
        case 'pushup':
            return '팔굽혀펴기';
        default:
            return '';
    }
}

//일일퀘스트 조회
// 서버 코드
app.get('/daily-quests/today', authenticate, async (req, res) => {
    const userId = req.user.id;
    const connection = await pool.getConnection();

    try {
        // 1. 유저의 현재 퀘스트 데이터 가져오기
        const [userRows] = await connection.query(
            `SELECT targetExercise, targetcount, targetSet, targetCheck, level
             FROM user_data 
             WHERE user_id = ?`,
            [userId]
        );

        if (userRows.length === 0) {
            return res.status(404).json({ error: '사용자 데이터를 찾을 수 없습니다.' });
        }

        const { targetExercise, targetcount, targetSet, targetCheck, level} = userRows[0];

        // 2. 오늘 날짜 및 운동 정보
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];

        // 3. 보상 정보 가져오기 (daily_quests 테이블에서 해당 운동, 레벨 기준으로)
        const [questRows] = await connection.query(
            `SELECT coin, experience, is_success 
             FROM daily_quests 
             WHERE user_id = ? AND exercise_type = ? AND level = ?`,
            [userId, targetExercise, level]
        );

        if (questRows.length === 0) {
            return res.status(404).json({ error: '해당 일일 퀘스트를 찾을 수 없습니다.' });
        }

        const { coin, experience, is_success } = questRows[0];

        res.json([{
            date: dateStr,
            exercise_type: targetExercise,
            name: getExerciseName(targetExercise),
            icon: getExerciseIcon(targetExercise),
            count: targetcount,
            sets: targetSet,
            completed: is_success,
            reward: coin,
            exp: experience
        }]);

    } catch (err) {
        console.error("오늘의 퀘스트 조회 실패:", err);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});





//종료된 퀘스트
app.get('/ended-quests', authenticate, async (req, res) => {
    const userId = req.user.id;

    const connection = await pool.getConnection();
    try {
        // 이틀 전까지의 종료된 퀘스트 조회
        const today = new Date();
        const twoDaysAgo = new Date(today);  // 원본 복사
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

        const [rows] = await connection.query(`
            SELECT exercise_type, goal_count, sets, completed_sets, is_success, experience, coin, reset_at
            FROM ended_quests
            WHERE user_id = ?
            AND DATE(reset_at) >= ?
        `, [userId, twoDaysAgo.toISOString().split('T')[0]]);

        
        console.log(rows);
        const questMap = {
            squat: { name: "스쿼트", icon: "스쿼트" },
            plank: { name: "플랭크", icon: "플랭크" },
            pushup: { name: "팔굽혀펴기", icon: "팔굽혀펴기" },
        };

        const endedQuests = rows.map(q => ({
            date: q.reset_at.toISOString().split('T')[0],  // ✅ Date 객체를 문자열로 변환 후 split
            name: questMap[q.exercise_type]?.name || q.exercise_type,
            icon: questMap[q.exercise_type]?.icon || "default.png",
            count: q.goal_count,
            sets: q.sets,
            completed: q.is_success === 1,
            reward: q.coin,
            exp: q.experience
        }));


        res.json(endedQuests);

    } catch (err) {
        console.error("종료된 퀘스트 조회 실패:", err);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});


//도전과제 전달
app.get('/challenge', authenticate, async (req, res) => {
    const userId = req.user.id;

    const connection = await pool.getConnection();
    try {
        const [userRows] = await connection.query(
            `SELECT challenge_level FROM user_data WHERE user_id = ?`,
            [userId]
        );

        if (userRows.length === 0) {
            return res.status(404).json({ error: '사용자 데이터를 찾을 수 없습니다.' });
        }

        const challengeLevel = userRows[0].challenge_level;

        const [rows] = await connection.query(
            `SELECT exercise_type, goal_count, is_success, coin, exp, exec_count
             FROM challenge_quests
             WHERE user_id = ? AND level = ?`,
            [userId, challengeLevel]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: '도전과제 정보가 없습니다.' });
        }

        const response = rows.map(row => {
            const remainingCount = Math.max(0, row.goal_count - row.exec_count);
            const completed = row.is_success === 1;

            return {
                name: getExerciseName(row.exercise_type),
                icon: getExerciseIcon(row.exercise_type),
                count: remainingCount,
                completed,
                reward: row.coin,
                exp: row.exp
            };
        });

        res.json(response);
    } catch (error) {
        console.error('도전과제 조회 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});




//랭킹 시스템
app.get('/ranking', authenticate, async (req, res) => {
    const userId = req.user.id;  // 로그인된 사용자 ID

    const connection = await pool.getConnection();
    try {
        // 친구 목록 가져오기
        const [friendsList] = await connection.query(
            `SELECT friend_id FROM friends WHERE user_id = ?`,
            [userId]
        );

        // 친구 목록에서 ID만 추출
        const friendIds = friendsList.map(friend => friend.friend_id);

        // 친구 목록에 자기 자신도 포함 (중복 제거)
        const rankingUserIds = Array.from(new Set([...friendIds, userId]));

        // 랭킹 조회 쿼리 - 순위 계산 없이 데이터만 가져오기
        const [rows] = await connection.query(
            `SELECT u.nickname, ud.total_count
             FROM user_data ud
             JOIN users u ON ud.user_id = u.id
             WHERE ud.user_id IN (?)
             ORDER BY ud.total_count DESC
             LIMIT 10`,
            [rankingUserIds]
        );

        // Node.js에서 순위 붙이기
        const ranking = rows.map((item, index) => ({
            rank: index + 1,
            nickname: item.nickname,
            exerciseCount: item.total_count,
        }));

        res.json({ ranking });

    } catch (error) {
        console.error('랭킹 조회 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});




//상점에서 코인 갯수 제공
app.get('/shop/coin', authenticate, async (req, res) => {
    const userId = req.user.id;

    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query(
            `SELECT coin FROM user_data WHERE user_id = ?`,
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: '사용자 정보를 찾을 수 없습니다.' });
        }

        res.json({ coin: rows[0].coin });

    } catch (error) {
        console.error('코인 조회 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});

// 일일퀘스트 실행 결과 받아오기
// app.post('/get_daily', async (req, res) => {
//     const userId = req.user.id; // 인증된 사용자의 ID
//     const { exerciseType, completedSets } = req.body; // 퀘스트 유형과 완료된 세트 수

//     // DB 연결
//     const connection = await pool.getConnection();
//     try {
//         const [userRows] = await connection.query(`
//             SELECT level FROM user_data WHERE user_id = ?`,
//             [userId]
//         );

//         if (userRows.length === 0) {
//             return res.status(404).json({ error: '사용자 데이터를 찾을 수 없습니다.' });
//         }

//         const level = userRows[0].level; // user_data에서 level 값을 가져옴
//         // 사용자의 레벨도 확인하여 퀘스트 정보 가져오기
//         const [questRows] = await connection.query(
//             `SELECT * FROM daily_quests 
//              WHERE user_id = ? AND exercise_type = ? AND level = ? AND is_reset = 0`,
//             [userId, exerciseType, level] // 사용자의 레벨도 고려
//         );

//         if (questRows.length === 0) {
//             return res.status(404).json({ error: '해당 퀘스트 정보를 찾을 수 없습니다.' });
//         }

//         const quest = questRows[0];
//         const { goal_count, coin, experience, sets, id, is_success } = quest;

//         // 완료된 세트 수가 목표 세트 수와 일치하는지 확인
//         if (completedSets === sets && is_success === 0) {
//             // 퀘스트 성공 처리 (세트가 목표 수와 일치하면)
//             await connection.query(
//                 `UPDATE daily_quests 
//                  SET is_success = 1, completed_sets = ?
//                  WHERE id = ?`,
//                 [completedSets, completedSets, id]
//             );

//             // 사용자 데이터 업데이트 (total_count, coin, level, experience)
//             const [userRows] = await connection.query(
//                 `SELECT * FROM user_data WHERE user_id = ?`,
//                 [userId]
//             );
            
//             if (userRows.length === 0) {
//                 return res.status(404).json({ error: '사용자 데이터를 찾을 수 없습니다.' });
//             }

//             const user = userRows[0];

//             // total_count, coin, experience 업데이트
//             await connection.query(
//                 `UPDATE user_data 
//                  SET total_count = total_count + ?, coin = coin + ?, experience = experience + ? 
//                  WHERE user_id = ?`,
//                 [completedSets, coin, experience, userId] // 퀘스트에서 받은 coin과 experience 반영
//             );

//             // 성공 응답 반환
//             res.status(200).json({
//                 success: true,
//                 message: '퀘스트 성공!',
//             });

//         } else {
//             // 세트 수가 목표 세트 수와 다를 경우 업데이트 처리 (단, 목표 세트는 넘지 않도록)
//             await connection.query(
//                 `UPDATE daily_quests 
//                  SET completed_sets = ? 
//                  WHERE id = ?`,
//                 [completedSets, id]
//             );

//             // 실패 응답 반환
//             res.status(200).json({
//                 success: false,
//                 message: '목표 세트를 완료하지 못했습니다.'
//             });
//         }

//     } catch (error) {
//         console.error('일일 퀘스트 처리 오류:', error);
//         res.status(500).json({ error: '서버 오류가 발생했습니다.' });
//     } finally {
//         connection.release(); // DB 연결 종료
//     }
// });

// app.post('/get_challenge', async (req, res) => {
//     const userId = req.user.id; // 인증된 사용자의 ID
//     const { challengeType, completedCount } = req.body; // 도전 과제 유형과 완료된 갯수

//     // DB 연결
//     const connection = await pool.getConnection();
//     try {
//         // 사용자의 도전 과제 레벨을 확인하여 도전 과제 정보 가져오기
//         const [userRows] = await connection.query(
//             `SELECT challenge_level FROM user_data WHERE user_id = ?`,
//             [userId]
//         );

//         if (userRows.length === 0) {
//             return res.status(404).json({ error: '사용자 데이터를 찾을 수 없습니다.' });
//         }

//         const challengeLevel = userRows[0].challenge_level;
//         const [challengeRows] = await connection.query(
//             `SELECT * FROM challenge_quests 
//              WHERE user_id = ? AND exercise_type = ? AND level = ? AND is_success = 0`,
//             [userId, challengeType, challengeLevel] // 사용자의 도전 과제 레벨을 기준으로
//         );

//         if (challengeRows.length === 0) {
//             return res.status(404).json({ error: '해당 도전 과제 정보를 찾을 수 없습니다.' });
//         }

//         const challenge = challengeRows[0];
//         const { goal_count, id, is_success } = challenge;

//         // 도전 과제 성공 여부 확인
//         if (completedCount >= goal_count && is_success === 0) {
//             // 사용자 데이터 업데이트 (total_count)
//             const [userRows] = await connection.query(
//                 `SELECT * FROM user_data WHERE user_id = ?`,
//                 [userId]
//             );
            
//             if (userRows.length === 0) {
//                 return res.status(404).json({ error: '사용자 데이터를 찾을 수 없습니다.' });
//             }

//             const user = userRows[0];

//             // total_count 업데이트
//             await connection.query(
//                 `UPDATE user_data 
//                  SET total_count = total_count + ?, challenge_level = challenge_level + 1 
//                  WHERE user_id = ?`,
//                 [completedCount, userId] // 완료된 갯수만큼 total_count 증가, challenge_level 1 증가
//             );

//             // 성공 응답 반환
//             res.status(200).json({
//                 success: true,
//                 message: '도전 과제 성공!',
//             });

//         } else {
//             // 완료된 갯수가 목표 갯수보다 적으면 변화 없음
//             res.status(200).json({
//                 success: false,
//                 message: '도전 과제를 완료하지 못했습니다.'
//             });
//         }

//     } catch (error) {
//         console.error('도전 과제 처리 오류:', error);
//         res.status(500).json({ error: '서버 오류가 발생했습니다.' });
//     } finally {
//         connection.release(); // DB 연결 종료
//     }
// });

//운동 결과 받아오기 
// app.post('/submit_quest', authenticate, async (req, res) => {
//     const userId = req.user.id;
//     let { questType, exerciseType, completedCount } = req.body;

//     // 1. 한글 → 영어 매핑
//     const questTypeMap = {
//         '일반모드': 'daily',
//         '사용자모드': 'challenge'
//     };

//     const exerciseTypeMap = {
//         '스쿼트': 'squat',
//         '플랭크': 'plank',
//         '푸쉬업': 'pushup',
//         '팔굽혀펴기': 'pushup' // 혹시 이렇게 올 경우도 커버
//     };

//     questType = questTypeMap[questType] || questType;
//     exerciseType = exerciseTypeMap[exerciseType] || exerciseType;

//     const connection = await pool.getConnection();
//     try {
//         const [userRows] = await connection.query(
//             `SELECT level, challenge_level FROM user_data WHERE user_id = ?`,
//             [userId]
//         );

//         if (userRows.length === 0) {
//             return res.status(404).json({ error: '사용자 데이터를 찾을 수 없습니다.' });
//         }

//         const user = userRows[0];
//         const level = user.level;
//         const challengeLevel = user.challenge_level;

//         let questQuery = '';
//         let questParams = [];

//         if (questType === 'daily') {
//             questQuery = `SELECT * FROM daily_quests 
//                           WHERE user_id = ? AND exercise_type = ? AND level = ? AND is_reset = 0`;
//             questParams = [userId, exerciseType, level];
//         } else if (questType === 'challenge') {
//             questQuery = `SELECT * FROM challenge_quests 
//                           WHERE user_id = ? AND exercise_type = ? AND level = ? AND is_success = 0`;
//             questParams = [userId, exerciseType, challengeLevel];
//         } else {
//             return res.status(400).json({ error: '유효하지 않은 퀘스트 유형입니다.' });
//         }

//         const [questRows] = await connection.query(questQuery, questParams);

//         if (questRows.length === 0) {
//             return res.status(404).json({ error: '해당 퀘스트 정보를 찾을 수 없습니다.' });
//         }

//         const quest = questRows[0];
//         const { goal_count, id, is_success, coin, experience, sets } = quest;

//         // total_count는 무조건 증가
//         await connection.query(
//             `UPDATE user_data 
//              SET total_count = total_count + ? 
//              WHERE user_id = ?`,
//             [completedCount, userId]
//         );
        
//         await connection.query(
//             `INSERT INTO daily_exercise_logs (user_id, exercise_type, count, performed_at)
//             VALUES (?, ?, ?, CURDATE())`,
//             [userId, exerciseType || 'unknown', completedCount]
//         );
        

//         let success = false;

//         if (questType === 'daily') {
//             const completedSets = Math.floor(completedCount / goal_count); // 세트 수 계산

//             if (completedSets >= sets && is_success === 0) {
//                 await connection.query(
//                     `UPDATE daily_quests 
//                     SET is_success = 1, completed_sets = ? 
//                     WHERE id = ?`,
//                     [completedSets, id]
//                 );

//                 await connection.query(
//                     `UPDATE user_data 
//                     SET coin = coin + ?, experience = experience + ? 
//                     WHERE user_id = ?`,
//                     [coin, experience, userId]
//                 );

//                 success = true;
//             } else {
//                 await connection.query(
//                     `UPDATE daily_quests 
//                     SET completed_sets = ? 
//                     WHERE id = ?`,
//                     [completedSets, id]
//                 );
//             }
//         } else if (questType === 'challenge') {
//             if (completedCount >= goal_count && is_success === 0) {
//                 await connection.query(
//                     `UPDATE challenge_quests 
//                      SET is_success = 1 
//                      WHERE id = ?`,
//                     [id]
//                 );

//                 await connection.query(
//                     `UPDATE user_data 
//                      SET challenge_level = challenge_level + 1 
//                      WHERE user_id = ?`,
//                     [userId]
//                 );

//                 success = true;
//             }
//         }

//         res.status(200).json({
//             success,
//             message: success ? '퀘스트 성공!' : '운동이 기록되었습니다.',
//         });

//     } catch (error) {
//         console.error('퀘스트 처리 오류:', error);
//         res.status(500).json({ error: '서버 오류가 발생했습니다.' });
//     } finally {
//         connection.release();
//     }
// });

// // 일반 모드 운동 결과 가져오기
// app.post('/submit_manual_exercise', authenticate, async (req, res) => {
//     const userId = req.user.id;
//     const { completedCount } = req.body;

//     if (!completedCount || isNaN(completedCount) || completedCount <= 0) {
//         return res.status(400).json({ error: '유효한 운동 개수를 입력해주세요.' });
//     }

//     const connection = await pool.getConnection();
//     try {
//         // total_count 증가
//         await connection.query(
//             `UPDATE user_data 
//              SET total_count = total_count + ?
//              WHERE user_id = ?`,
//             [completedCount, userId]
//         );
//         await connection.query(
//             `INSERT INTO daily_exercise_logs (user_id, exercise_type, count, performed_at)
//             VALUES (?, ?, ?, CURDATE())`,
//             [userId, exerciseType || 'unknown', completedCount]
//         );

//         res.status(200).json({
//             success: true,
//             message: `${completedCount}개의 운동이 정상적으로 기록되었습니다.`,
//         });
//     } catch (error) {
//         console.error('사용자 운동 기록 오류:', error);
//         res.status(500).json({ error: '서버 오류가 발생했습니다.' });
//     } finally {
//         connection.release();
//     }
// });

// 운동 결과 받아오기 통합
app.post('/submit_exercise', authenticate, async (req, res) => {
    const userId = req.user.id;
    let { questType, exerciseType, completedCount } = req.body;
    console.log(completedCount);
    // 한글 → 영어 매핑
    const questTypeMap = {
        '일반모드': 'daily',
        '자유모드': 'common',
    };
    const exerciseTypeMap = {
        '스쿼트': 'squat',
        '플랭크': 'plank',
        '푸쉬업': 'pushup',
        '팔굽혀펴기': 'pushup',
    };

    questType = questTypeMap[questType] || questType;
    exerciseType = exerciseTypeMap[exerciseType] || exerciseType;

    const connection = await pool.getConnection();

    try {
        const [userRows] = await connection.query(
            `SELECT level, challenge_level FROM user_data WHERE user_id = ?`,
            [userId]
        );
        if (userRows.length === 0) {
            return res.status(404).json({ error: '사용자 데이터를 찾을 수 없습니다.' });
        }
        const { level, challenge_level } = userRows[0];

        // 1. total_count 업데이트 (운동 횟수 누적)
        await connection.query(
            `UPDATE user_data SET total_count = total_count + ? WHERE user_id = ?`,
            [completedCount, userId]
        );

        // 2. daily 퀘스트 업데이트 (있으면)
        if (questType === 'daily') {
            const [dailyQuests] = await connection.query(
                `SELECT * FROM daily_quests WHERE user_id = ? AND exercise_type = ? AND level = ? AND is_reset = 0`,
                [userId, exerciseType, level]
            );
            if (dailyQuests.length > 0) {
                const dailyQuest = dailyQuests[0];
                const completedSets = Math.floor(completedCount / dailyQuest.goal_count);

                // 완료 세트수 업데이트 및 성공처리
                const newIsSuccess = completedSets >= dailyQuest.sets ? 1 : 0;

                await connection.query(
                    `UPDATE daily_quests SET completed_sets = ?, is_success = ? WHERE id = ?`,
                    [completedSets, newIsSuccess, dailyQuest.id]
                );

                // 보상 지급은 성공 시 한 번만 처리 (예: is_success가 0에서 1로 바뀔 때)
                if (dailyQuest.is_success === 0 && newIsSuccess === 1) {
                    await connection.query(
                        `UPDATE user_data SET coin = coin + ?, experience = experience + ? WHERE user_id = ?`,
                        [dailyQuest.coin, dailyQuest.experience, userId]
                    );
                }
            }
        }

        // 3. challenge_quests exec_count 누적 + 성공처리 (레벨 기준)
        const [challengeQuests] = await connection.query(
            `SELECT * FROM challenge_quests WHERE user_id = ? AND exercise_type = ? AND level = ? AND is_success = 0`,
            [userId, exerciseType, challenge_level]
        );

        if (challengeQuests.length > 0) {
            const challengeQuest = challengeQuests[0];
            const newExecCount = challengeQuest.exec_count + completedCount;

            let newIsSuccess = challengeQuest.is_success;
            if (newExecCount >= challengeQuest.goal_count) {
                newIsSuccess = 1;
            }

            await connection.query(
                `UPDATE challenge_quests SET exec_count = ?, is_success = ? WHERE id = ?`,
                [newExecCount, newIsSuccess, challengeQuest.id]
            );

            // 도전과제 성공 시 레벨업 (한 번만)
            if (challengeQuest.is_success === 0 && newIsSuccess === 1) {
                await connection.query(
                    `UPDATE user_data SET challenge_level = challenge_level + 1 WHERE user_id = ?`,
                    [userId]
                );
            }
        }

        // 4. 운동 로그 기록 (daily_exercise_logs)
        await connection.query(
            `INSERT INTO daily_exercise_logs (user_id, exercise_type, count, performed_at)
             VALUES (?, ?, ?, CURDATE())`,
            [userId, exerciseType || 'unknown', completedCount]
        );

        res.status(200).json({
            success: true,
            message: '운동 기록이 정상적으로 처리되었습니다.'
        });

    } catch (error) {
        console.error('운동 기록 처리 오류:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    } finally {
        connection.release();
    }
});


//상점 아이템 나타내기
app.get('/shop', authenticate, async (req, res) => {
    const userId = req.user.id;  // 로그인된 사용자 ID

    const connection = await pool.getConnection();
    try {
        // 사용자가 보유한 아이템 가져오기
        const [wardrobeItems] = await connection.query(
            `SELECT item_id FROM wardrobe WHERE user_id = ?`,
            [userId]
        );

        // 사용자가 보유한 아이템들의 ID 목록 추출
        const ownedItemIds = wardrobeItems.map(item => item.item_id);

        // 사용자가 보유하지 않은 아이템 조회
        const [availableItems] = await connection.query(
            `SELECT * FROM shop_items WHERE id NOT IN (?)`,
            [ownedItemIds.length > 0 ? ownedItemIds : [-1]]  // ownedItemIds가 없으면 모두 보여주기 위해 [-1] 사용
        );

        res.json({
            availableItems: availableItems  // 사용자가 보유하지 않은 아이템들
        });

    } catch (error) {
        console.error('상점 아이템 조회 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release(); // DB 연결 종료
    }
});

//운동 결과 전달 
app.get('/today-summary', authenticate, async (req, res) => {
    const userId = req.user.id;
    const connection = await pool.getConnection();
    try {
        // 1. 오늘 하루 전체 운동 횟수 합산 (종목 무관)
        const [exerciseRow] = await connection.query(
            `SELECT SUM(count) AS total_count
             FROM daily_exercise_logs
             WHERE user_id = ? AND performed_at = CURDATE()`,
            [userId]
        );

        const totalTodayCount = exerciseRow[0].total_count || 0;

        // 2. 오늘 일일 퀘스트의 남은 세트 수
        const [questRows] = await connection.query(
            `SELECT sets, completed_sets FROM daily_quests
             WHERE user_id = ? AND DATE(reset_at) = CURDATE()
             ORDER BY id DESC LIMIT 1`,
            [userId]
        );

        const remainingSets =
            questRows.length > 0
                ? Math.max(0, questRows[0].sets - questRows[0].completed_sets)
                : null;

        // 응답
        res.json({
            todayTotalExerciseCount: totalTodayCount / 2,
            remainingDailySets: remainingSets
        });
    } catch (error) {
        console.error('오늘 운동 요약 조회 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});



//아이템 구매
app.post('/buy', authenticate, async (req, res) => {
    const userId = req.user.id;  // 로그인된 사용자 ID
    const { itemId } = req.body;  // 구매하려는 아이템의 ID

    const connection = await pool.getConnection();
    try {
        // 1. 아이템 가격 가져오기
        const [item] = await connection.query(
            `SELECT price, name, type FROM shop_items WHERE id = ?`,
            [itemId]
        );

        if (item.length === 0) {
            return res.status(404).json({ error: '해당 아이템을 찾을 수 없습니다.' });
        }

        const itemPrice = item[0].price;

        // 2. 사용자의 코인 확인
        const [userData] = await connection.query(
            `SELECT coin FROM user_data WHERE user_id = ?`,
            [userId]
        );

        if (userData.length === 0) {
            return res.status(404).json({ error: '사용자 데이터를 찾을 수 없습니다.' });
        }

        const userCoin = userData[0].coin;

        // 3. 코인이 충분한지 확인
        if (userCoin < itemPrice) {
            return res.status(400).json({ error: '코인이 부족합니다.' });
        }

        // 4. 코인 차감
        await connection.query(
            `UPDATE user_data SET coin = coin - ? WHERE user_id = ?`,
            [itemPrice, userId]
        );
        
        const itemName = `${item[0].type}${itemId}`;
        // 5. 옷장에 아이템 추가
        await connection.query(
            `INSERT INTO wardrobe (user_id, item_id, item_type, equipped, item_name) 
             VALUES (?, ?, ?, 0, ?)`,  // 기본적으로 착용 안 함 (equipped = 0)
            [userId, itemId, item[0].type, itemName]
        );

        // 6. 응답 반환
        res.json({
            success: true,
            message: `${item[0].name} 아이템을 구매하셨습니다.`,
            remainingCoins: userCoin - itemPrice,
        });

    } catch (error) {
        console.error('아이템 구매 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release(); // DB 연결 종료
    }
});

//마이룸 확인
app.get('/myroom', authenticate, async (req, res) => {
    const userId = req.user.id;  // 로그인된 사용자 ID

    const connection = await pool.getConnection();
    try {
        // 1. 사용자가 보유한 아이템을 조회
        const [wardrobeItems] = await connection.query(
            `SELECT w.item_id, w.item_type, w.equipped, s.name 
             FROM wardrobe w
             JOIN shop_items s ON w.item_id = s.id
             WHERE w.user_id = ?`,
            [userId]
        );

        // 2. 아이템이 있다면 정보 반환
        const items = wardrobeItems.map(item => ({
            name: item.name,
            type: item.item_type,  // 'outer' 또는 'bottom'
            equipped: item.equipped === 1 ? true : false,  // 착용 여부
        }));

        // 3. 아이템이 있으면 배열을 반환, 없으면 빈 배열 반환
        res.json({
            items: items // 아이템이 없으면 빈 배열을 반환
        });

    } catch (error) {
        console.error('마이룸 조회 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release(); // DB 연결 종료
    }
});

// 유저 정보 (myroom and shop)
app.get('/user-info', authenticate, async(req, res) => {
    const userId = req.user.id;

    const connection = await pool.getConnection();

    try{
        const [userInfo] = await connection.query(
            `SELECT gender, state FROM user_data WHERE user_id = ?`,
            [userId]
        );
        if(userInfo.length === 0){
            return res.status(404).json({error: '사용자 정보를 찾을 수 없습니다.'});
        }
        
        res.json({
            gender: userInfo[0].gender,
            state: userInfo[0].state
        });
    } catch (error) {
        console.error('사용자 정보 조회 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release(); // DB 연결 종료
    }
})
//옷 착용
app.post('/wear', authenticate, async (req, res) => {
    const userId = req.user.id;
    const { outerid, bottomid } = req.body;

    const connection = await pool.getConnection();
    try {
        // === OUTER 처리 ===
        if (outerid && outerid !== 0) {
            // 기존 착용 해제
            await connection.query(
                `UPDATE wardrobe SET equipped = 0 WHERE user_id = ? AND item_type = 'outer' AND equipped = 1`,
                [userId]
            );

            // 새로 착용
            await connection.query(
                `UPDATE wardrobe SET equipped = 1 WHERE user_id = ? AND item_id = ? AND item_type = 'outer'`,
                [userId, outerid]
            );

            // 이름 불러와서 user_data.top에 저장
            const [outerItem] = await connection.query(
                `SELECT item_name FROM wardrobe WHERE user_id = ? AND item_id = ? AND item_type = 'outer'`,
                [userId, outerid]
            );
            if (outerItem.length > 0) {
                await connection.query(
                    `UPDATE user_data SET top = ? WHERE user_id = ?`,
                    [outerItem[0].item_name, userId]
                );
            }
        }

        // === BOTTOM 처리 ===
        if (bottomid && bottomid !== 0) {
            // 기존 착용 해제
            await connection.query(
                `UPDATE wardrobe SET equipped = 0 WHERE user_id = ? AND item_type = 'bottom' AND equipped = 1`,
                [userId]
            );

            // 새로 착용
            await connection.query(
                `UPDATE wardrobe SET equipped = 1 WHERE user_id = ? AND item_id = ? AND item_type = 'bottom'`,
                [userId, bottomid]
            );

            // 이름 불러와서 user_data.pants에 저장
            const [bottomItem] = await connection.query(
                `SELECT item_name FROM wardrobe WHERE user_id = ? AND item_id = ? AND item_type = 'bottom'`,
                [userId, bottomid]
            );
            if (bottomItem.length > 0) {
                await connection.query(
                    `UPDATE user_data SET pants = ? WHERE user_id = ?`,
                    [bottomItem[0].item_name, userId]
                );
            }
        }

        res.json({
            success: true,
            message: '착용이 완료되었습니다.',
        });

    } catch (error) {
        console.error('착용 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});



// 매일 자정마다 퀘스트 초기화 및 종료된 퀘스트로 이동
const resetDailyQuests = async () => {
    const connection = await pool.getConnection();
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const resetAt = yesterday.toISOString().split('T')[0];


        // 1. user_data에서 오늘의 퀘스트 정보를 ended_quests로 저장
        await connection.query(`
            INSERT INTO ended_quests (
                user_id, exercise_type, goal_count, sets, completed_sets, is_success, experience, coin, reset_at
            )
            SELECT 
                user_id,
                targetExercise,
                targetcount,
                targetSet,
                targetCheck,
                IF(targetCheck >= targetcount, 1, 0),
                35,  -- 기본 경험치
                20,  -- 기본 코인
                ?
            FROM user_data
            WHERE targetExercise IS NOT NULL
        `, [resetAt]);

        // 2. daily_quests 테이블 초기화
        await connection.query(`
            UPDATE daily_quests
            SET 
                completed_sets = 0,
                is_success = 0,
                reset_at = CURDATE()
        `);

        console.log('[✔] user_data 기반 ended_quests 저장 및 daily_quests 초기화 완료');
    } catch (err) {
        console.error('[❌] 퀘스트 리셋 실패:', err);
    } finally {
        connection.release();
    }
};

// 매일 자정 실행
cron.schedule('0 0 * * *', resetDailyQuests);

module.exports = resetDailyQuests;


// 서버 시작
app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on http://h4capston.site:${port}`);
});

