import { Component } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { Resume, Mistakes } from './resume';
import { ScriptService } from './script.service';
import { MessageService } from 'primeng/api';
import * as XLSX from 'xlsx';
import * as $ from 'jquery';
import { Packer, Document, Paragraph, HeadingLevel, AlignmentType } from "docx";
import { saveAs } from "file-saver";
import { threadId } from 'worker_threads';

declare let pdfMake: any ; 

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  providers: [MessageService]
})
export class AppComponent {
  personalForm: FormGroup;
  resumeForm: FormGroup;
  MistakeArr: FormArray;
  submitted = false;
  resume = new Resume();
  excelBtn: boolean = true;
  saveBtn: boolean = false;
  pdfBtn: boolean = true;

  studentInfo = [];
  class="";
  classtr="";
  testname="";
  subject="";
  attendanceTypes= [
    {label: 'Present', value: 'present'},
    {label: 'Absent', value: 'absent'}
  ];
  selectedAtt: string = 'present';
  subjectMarkList = [];
  qstnList = [];

  constructor(private scriptService: ScriptService, private formBuilder: FormBuilder, private messageService: MessageService) {
    this.scriptService.load('pdfMake', 'vfsFonts');
  }

  ngOnInit() {
    this.resumeForm = this.formBuilder.group({
      // Name: ['', Validators.required],
      // AdmNo: ['', Validators.required],
      // Class: ['', Validators.required],
      // Classtr: ['', Validators.required],
      // TestName: ['', Validators.required],
      // Subject: ['', Validators.required],
      MistakeArr: this.formBuilder.array([ this.createMistakesArray() ]),
      OtherDetails: [''],
    });
  }
  createMistakesArray(): FormGroup {
    return this.formBuilder.group({
      Qno: ['', Validators.required],
      Qn: [''],
      MaxMarks: ['', Validators.required],
      MistakesMade: [''],
      MarkObt: ['', Validators.required],
    });
  }
  addMistakeToForm(): void {
    this.MistakeArr = this.resumeForm.get('MistakeArr') as FormArray;
    this.MistakeArr.push(this.createMistakesArray());
  }
  get f() { return this.resumeForm.controls; }

  addMistake(index) {
    this.studentInfo[index].mistakes.push(new Mistakes());
  }

  onSave(index) {
    this.studentInfo[index].mistakes = this.resumeForm.value;
    this.studentInfo[index].maxTotal = 0;
    this.studentInfo[index].obtTotal = 0;
    if(this.studentInfo[index].attendance == 'present') {
      for(let k=0;k<this.studentInfo[index].mistakes.MistakeArr.length; k++) {
        this.studentInfo[index].maxTotal += parseInt(this.studentInfo[index].mistakes.MistakeArr[k].MaxMarks);
        this.studentInfo[index].obtTotal += parseFloat(this.studentInfo[index].mistakes.MistakeArr[k].MarkObt);
      }
      this.studentInfo[index].name = this.studentInfo[index].Name;
      this.studentInfo[index].admno = this.studentInfo[index].AdmNo;

      if(this.subjectMarkList.length == 0) {
        this.subjectMarkList.push(
          {
            SlNo: this.studentInfo[index].SlNo,
            AdmNo: this.studentInfo[index].AdmNo,
            Name: this.studentInfo[index].Name,
            Marks: this.studentInfo[index].obtTotal
          }
        );
        this.showSuccess(index);
        this.saveBtn = true;
        this.pdfBtn = false;
      }
      else {
        let flag = 0, i;
        for(i=0; i< this.subjectMarkList.length; i++) {
          if(this.subjectMarkList[i].AdmNo === this.studentInfo[index].AdmNo) {
            flag = 1;
            break;
          }
        }
        if(flag == 1) {
          this.subjectMarkList[i].Marks = this.studentInfo[index].obtTotal;
          this.showSuccess(index);
          this.saveBtn = true;
          this.pdfBtn = false;
        }
        else {
          this.subjectMarkList.push(
            {
              SlNo: this.studentInfo[index].SlNo,
              AdmNo: this.studentInfo[index].AdmNo,
              Name: this.studentInfo[index].Name,
              Marks: this.studentInfo[index].obtTotal
            }
          );
          this.showSuccess(index);
          this.saveBtn = true;
          this.pdfBtn = false;
        }
      }
    }
    else {
      this.subjectMarkList.push(
      {
        SlNo: this.studentInfo[index].SlNo,
        AdmNo: this.studentInfo[index].AdmNo,
        Name: this.studentInfo[index].Name,
        Marks: this.studentInfo[index].obtTotal
      });
      this.showSuccess(index);
      this.saveBtn = true;
      this.pdfBtn = false;
    }
    if(this.subjectMarkList.length == this.studentInfo.length && this.subjectMarkList.length != 0) {
      this.excelBtn = false;
    }
  }

  generatePdf(action = 'open', index) {
    const documentDefinition = this.getDocumentDefinition(index);
    // const doc = new Document();
    // doc.addSection(this.getDocumentDefinition(index));
    console.log(documentDefinition);
    switch (action) {
      case 'open': pdfMake.createPdf(documentDefinition).open(); break;
      case 'print': pdfMake.createPdf(documentDefinition).print(); break;
      case 'download': pdfMake.createPdf(documentDefinition).download(); break;

      default: pdfMake.createPdf(documentDefinition).open(); break;
    }
    // Packer.toBlob(doc).then(blob => {
    //   console.log(blob);
    //   saveAs(blob, "example.docx");
    //   console.log("Document created successfully");
    // });

  }

  getDocumentDefinition(index) {
    if(this.studentInfo[index].attendance == 'absent') {
      this.studentInfo[index].OtherDetails = 'Absent in the Exam'
    }
    // sessionStorage.setItem('resume', JSON.stringify(this.resume));
    return {
      content: [
        {
          text: this.testname+' VALIDATION RESULT \n'+'\n'+this.subject,
          bold: true,
          fontSize: 20,
          alignment: 'center',
          margin: [0, 0, 0, 20]
        },
        {
          text: 'Marks: ' + this.studentInfo[index].obtTotal + '/' + this.studentInfo[index].maxTotal,
          alignment: 'right',
          bold: true
        },
        {
          columns: [
            [{
              text: this.studentInfo[index].Name,
              style: 'name'
            },
            {
              text: this.studentInfo[index].AdmNo
            }
            ],
            [
              // this.getProfilePicObject()
              {
                text: this.classtr,
                alignment: 'right',
                style: 'name'
              },
              {
                text:  this.class,
                alignment: 'right'
              }
            ]
          ]
        },
        {
          text: 'Mistakes',
          style: 'header'
        },
        this.getExperienceObject(this.studentInfo[index].mistakes),
        {
          text: 'Other Details',
          style: 'header'
        },
        {
          text: this.studentInfo[index].mistakes.OtherDetails
        },
        {
          text: 'Signature',
          style: 'sign'
        },
        {
          columns : [
              { qr: this.studentInfo[index].Name + '\nAdm No: ' + this.studentInfo[index].AdmNo + '\nExam: ' +this.testname + 
               '\nSubject: '+this.subject+'\nMarks: '+this.studentInfo[index].obtTotal+' Out of '+this.studentInfo[index].maxTotal, fit : 100 },
              {
              text: `(${this.classtr})`,
              alignment: 'right',
              }
          ]
        }
      ],
      info: {
        title: this.studentInfo[index].Name,
        author: this.studentInfo[index].Name,
        subject: 'PAPER VALIDATION',
        keywords: 'EXAM, ONLINE EXAM',
      },
      styles: {
        header: {
          fontSize: 18,
          bold: true,
          margin: [0, 20, 0, 10],
          decoration: 'underline'
        },
        name: {
          fontSize: 16,
          bold: true
        },
        jobTitle: {
          fontSize: 14,
          bold: true,
          italics: true
        },
        sign: {
          margin: [0, 50, 0, 10],
          alignment: 'right',
          italics: true
        },
        tableHeader: {
          bold: true,
        }
      }
    };
  }

  getExperienceObject(mistakes) {

    const exs = [];

    mistakes.MistakeArr.forEach(mistake => {
      exs.push(
        [{
          columns: [
            {
              text: mistake.Qno,
              style: 'jobTitle'
            },
            [{
              text: ""
            },
            {
              text: mistake.MistakesMade
            }
            ],
            [{
              text: 'Max Marks: '+mistake.MaxMarks,
              alignment: 'right'
            },
            {
              text: 'Mark Obt.' + mistake.MarkObt,
              alignment: 'right'
            }]
          ]
        }]
      );
    });

    return {
      table: {
        widths: ['*'],
        body: [
          ...exs
        ]
      }
    };
  }

  getProfilePicObject() {
    if (this.resume.profilePic) {
      return {
        image: this.resume.profilePic ,
        width: 75,
        alignment : 'right'
      };
    }
    return null;
  }

  fileChanged(e) {
    const file = e.target.files[0];
    this.getBase64(file);
  }

  getBase64(file) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      this.resume.profilePic = reader.result as string;
    };
    reader.onerror = (error) => {
      console.log('Error: ', error);
    };
  }

  // addSkill() {
  //   this.resume.skills.push(new Skill());
  // }

  onFileChangeStudentList(event: any) {
    /* wire up file reader */
    const target: DataTransfer = <DataTransfer>(event.target);
    if (target.files.length !== 1) {
      throw new Error('Cannot use multiple files');
    }
    if(target.files[0].name.split(".")[1] != 'xlsx') {
      throw new Error("Please upload .xlsx file");
    }
    const reader: FileReader = new FileReader();
    reader.readAsBinaryString(target.files[0]);
    reader.onload = (e: any) => {
      /* create workbook */
      const binarystr: string = e.target.result;
      const wb: XLSX.WorkBook = XLSX.read(binarystr, { type: 'binary' });

      /* selected the first sheet */
      const wsname: string = wb.SheetNames[0];
      const ws: XLSX.WorkSheet = wb.Sheets[wsname];

      /* save data */
      const data = XLSX.utils.sheet_to_json(ws); // to get 2d array pass 2nd parameter as object {header: 1}
      // console.log(data); // Data will be logged in array format containing objects
      this.studentInfo = data;
      for(let student of this.studentInfo) {
        student.attendance = 'present';
      }
    };
  }

  onFileChangeQstnList(event: any) {
    /* wire up file reader */
    const target: DataTransfer = <DataTransfer>(event.target);
    if (target.files.length !== 1) {
      throw new Error('Cannot use multiple files');
    }
    if(target.files[0].name.split(".")[1] != 'xlsx') {
      throw new Error("Please upload .xlsx file");
    }
    const reader: FileReader = new FileReader();
    reader.readAsBinaryString(target.files[0]);
    reader.onload = (e: any) => {
      /* create workbook */
      const binarystr: string = e.target.result;
      const wb: XLSX.WorkBook = XLSX.read(binarystr, { type: 'binary' });

      /* selected the first sheet */
      const wsname: string = wb.SheetNames[0];
      const ws: XLSX.WorkSheet = wb.Sheets[wsname];

      /* save data */
      const data = XLSX.utils.sheet_to_json(ws); // to get 2d array pass 2nd parameter as object {header: 1}
      // console.log(data); // Data will be logged in array format containing objects
      this.qstnList = data;
    };
  }

  exportExcel() {
    const workBook = XLSX.utils.book_new(); // create a new blank book
    const workSheet = XLSX.utils.json_to_sheet(this.subjectMarkList);

    XLSX.utils.book_append_sheet(workBook, workSheet, this.subject); // add the worksheet to the book
    XLSX.writeFile(workBook, this.subject+'_'+this.class+'.xlsx'); // initiate a file download in browser
  }
  
  showSuccess(index) {
    this.messageService.add({severity:'success', summary: 'Saved!', detail:'Data Saved for: \n'+this.studentInfo[index].Name+':'+this.studentInfo[index].AdmNo});
  }
  
  tabChanged(e) {
    this.saveBtn = false;
    this.pdfBtn = true;
    this.selectedAtt = this.studentInfo[e.index].attendance;
  }

  validateMarks(index) {
    let maxMarksArr = $('.mm');
    let obtMarksArr = $('.om');
    if(maxMarksArr[index].value != null && obtMarksArr[index].value != null) {
      if(maxMarksArr[index].value<obtMarksArr[index].value) {
        alert("Obtained Marks  cannot be more than Maximum Marks");
        obtMarksArr[index].focus();
        obtMarksArr[index].value = null;
      }
    }
  }

  attChanged(index) {
    this.selectedAtt = this.studentInfo[index].attendance;
    console.log(this.selectedAtt);
  }
}
