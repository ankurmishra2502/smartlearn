// Sample leaderboard data. All sample users have email sample.*@example.com so they can be removed.
require('/Users/prachisquint/smartlearn/backend/node_modules/dotenv').config({path:'/Users/prachisquint/smartlearn/backend/.env',quiet:true});
const pool=require('/Users/prachisquint/smartlearn/backend/config/db');

const QUIZ='db265f28-fc71-44ca-8a8c-bde769dd898f';
const OLY='7f355b41-749b-448a-a04d-ec44ef803b72', NEET='6b92c320-2680-426e-89e3-d53c2c0cd558', JEE='2a69f1a6-0bda-4575-82f9-0a37590b6c1b';
// xp, streak days, correct answers out of 15, seconds per question
const USERS=[
 ['rohan.verma','Rohan','Verma',OLY,'Noida',4210,35,13,35],
 ['ananya.iyer','Ananya','Iyer',OLY,'Pune',2760,21,12,40],
 ['kabir.singh','Kabir','Singh',OLY,'New Delhi',1250,7,10,55],
 ['meera.nair','Meera','Nair',OLY,'Kochi',640,3,8,70],
 ['aditya.rao','Aditya','Rao',OLY,'Hyderabad',90,1,5,85],
 ['ishita.gupta','Ishita','Gupta',NEET,'Jaipur',3880,19,12,45],
 ['vivek.kumar','Vivek','Kumar',JEE,'Patna',1900,9,11,50],
 ['diya.joshi','Diya','Joshi',NEET,'Mumbai',520,4,9,60],
];

async function clean(c){
  await c.query(`DELETE FROM v2_xp_transactions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sample.%@example.com')`);
  await c.query(`DELETE FROM v2_question_attempts WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sample.%@example.com')`);
  await c.query(`DELETE FROM v2_stage_attempts WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sample.%@example.com')`);
  await c.query(`DELETE FROM v2_quiz_attempts WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sample.%@example.com')`);
  await c.query(`DELETE FROM users WHERE email LIKE 'sample.%@example.com'`);
}

(async()=>{
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await clean(c);
  if(process.argv[2]==='clean'){await c.query('COMMIT');console.log('removed sample data');process.exit(0)}

  const stages=(await c.query(`SELECT id,difficulty FROM v2_quiz_stages WHERE quiz_id=$1 ORDER BY display_order`,[QUIZ])).rows;
  const questions={};
  for(const st of stages){
    questions[st.id]=(await c.query(`SELECT q.id,q.correct_option_key,
        (SELECT json_agg(json_build_object('id',o.id,'key',o.option_key)) FROM v2_quiz_options o WHERE o.question_id=q.id) opts
        FROM v2_quiz_questions q WHERE q.stage_id=$1 ORDER BY q.display_order`,[st.id])).rows;
  }

  for(const [slug,first,last,goal,city,xp,streak,correct,secs] of USERS){
    const u=(await c.query(`INSERT INTO users (email,first_name,last_name,role,is_onboarded,email_verified,auth_provider)
        VALUES ($1,$2,$3,'student',true,true,'email') RETURNING id`,[`sample.${slug}@example.com`,first,last])).rows[0].id;
    await c.query(`INSERT INTO user_academic_details (user_id,school_name,district,state,course_or_standard) VALUES ($1,'Sample School',$2,'India','Class 12')`,[u,city]);
    await c.query(`INSERT INTO user_goals (user_id,goal_id,is_primary) VALUES ($1,$2,true)`,[u,goal]);
    await c.query(`INSERT INTO v2_user_stats (user_id,total_xp,level) VALUES ($1,$2,$3)`,[u,xp,Math.floor(xp/500)+1]);

    const qa=(await c.query(`INSERT INTO v2_quiz_attempts (quiz_id,user_id,attempt_number,status,started_at,completed_at)
        VALUES ($1,$2,1,'completed',now()-interval '1 day',now()-interval '1 day') RETURNING id`,[QUIZ,u])).rows[0].id;

    let i=0, right=0;
    for(const st of stages){
      const sa=(await c.query(`INSERT INTO v2_stage_attempts (quiz_attempt_id,stage_id,user_id,attempt_number,status,started_at,completed_at)
          VALUES ($1,$2,$3,1,'passed',now()-interval '1 day',now()-interval '1 day') RETURNING id`,[qa,st.id,u])).rows[0].id;
      for(const q of questions[st.id]){
        const isRight = right < correct && (i % 15) < 15 && (i < correct + 0 ? true : false);
        // spread correct answers evenly: first `correct` questions are right
        const ok = i < correct;
        if(ok) right++;
        const opts=q.opts||[];
        const pick=(ok?opts.find(o=>o.key===q.correct_option_key):opts.find(o=>o.key!==q.correct_option_key))||opts[0];
        const dayAgo = i % Math.max(streak,1);           // activity on `streak` consecutive days ending today
        await c.query(`INSERT INTO v2_question_attempts (stage_attempt_id,question_id,quiz_attempt_id,user_id,status,selected_option_id,is_correct,question_started_at,answered_at,time_taken_ms)
            VALUES ($1,$2,$3,$4,'answered',$5,$6, now()-($7::int * interval '1 day') - ($8::bigint * interval '1 millisecond'), now()-($7::int * interval '1 day'), $8::bigint)`,
            [sa,q.id,qa,u,pick?pick.id:null,ok,dayAgo,secs*1000]);
        i++;
      }
    }
    // XP history: ~30% earned this week, the rest earlier, totalling xp
    const week=Math.round(xp*0.3/10)*10, older=xp-week;
    if(week>0) await c.query(`INSERT INTO v2_xp_transactions (user_id,xp,source_type,source_id,quiz_id) VALUES ($1,$2,'stage_pass',gen_random_uuid(),$3)`,[u,week,QUIZ]);
    await c.query(`INSERT INTO v2_xp_transactions (user_id,xp,source_type,source_id,quiz_id,created_at) VALUES ($1,$2,'stage_pass',gen_random_uuid(),$3,now()-interval '20 days')`,[u,older,QUIZ]);
  }
  await c.query('COMMIT');
  console.log('inserted',USERS.length,'sample learners');
  process.exit(0);
 }catch(e){await c.query('ROLLBACK');console.error('FAILED, rolled back:',e.message);process.exit(1)}
})();
