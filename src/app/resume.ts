export class Resume {
    profilePic: string;
    name: string;
    admno: string;
    class: number;
    classtr: string;
    testname: string;
    subject: string;
    attendance: string;
    // socialProfile: string;
    mistakes: Mistakes[] = [];
    otherDetails: string;

    constructor() {
        this.mistakes.push(new Mistakes());
    }
}

export class Mistakes {
    qno: string;
    qn: string;
    markObt: number;
    maxMarks: number;
    maxTotal: number;
    obtTotal: number;
    value: string;
}

// export class Education {
//     degree: string;
//     college: string;
//     passingYear: string;
//     percentage: number;
// }

// export class Skill {
//     value: string;
// }
